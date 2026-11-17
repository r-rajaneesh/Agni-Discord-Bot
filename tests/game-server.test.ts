import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, setDefaultTimeout, spyOn, test } from "bun:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { CHUNK, LAND_PORTAL, LAND_SPAWN, cachedChunkCount, chunkOf } from "../game/chunks";
import { DAY_MS, HOUSE_DOOR, MAX_ENERGY, ROCK_REGROW_MS, TICK_MS, TREE_REGROW_MS, WALK_SPEED, enter, use, type TDir, type TInstance } from "../game/engine";
import * as entities from "../game/entities";
import { T } from "../game/map";
import type { TServerMsg } from "../game/protocol";
import { LAND_GATE, SHOP_DOORS, TOWN_SPAWN, WORLD_CHUNKS, worldTerrain } from "../game/world";
import EconomyManager from "../managers/EconomyManager";
import GameServer, { LOBBY_CAP, type TGameServerDeps } from "../managers/GameServer";
import InstanceStore from "../managers/InstanceStore";
import { Earning, Inventory, LedgerEntry, MarketItem, Order, Wallet } from "../managers/models/Economy";
import { Land, LandTile, PlayerState } from "../managers/models/Game";

let replset: MongoMemoryReplSet;
const models = [Wallet, Inventory, LedgerEntry, MarketItem, Order, Earning, Land, LandTile, PlayerState] as unknown as mongoose.Model<any>[];
setDefaultTimeout(60_000);

beforeAll(async () => {
	replset = await MongoMemoryReplSet.create({
		replSet: { count: 1, storageEngine: "wiredTiger" },
		binary: process.env.MONGOMS_SYSTEM_BINARY ? undefined : { systemBinary: "/usr/bin/mongod" },
	});
	await mongoose.connect(replset.getUri(), { dbName: "agni_test_game_server" });
	await Promise.all(models.map((m) => m.init()));
});

afterAll(async () => {
	await mongoose.disconnect();
	await replset.stop();
});

const quiet = { info: () => {}, warn: () => {}, error: () => {} };
const eco = new EconomyManager({ transactions: true, warn: () => {} });
const store = new InstanceStore(eco, quiet);

// Tokens are "tok:<userId>"; guild membership per user
const GUILDS: Record<string, { id: string; name: string }> = {
	G: { id: "G", name: "G-name" },
	H: { id: "H", name: "H-name" },
	K: { id: "K", name: "K-name" },
};
const member: Record<string, string[]> = {};
const auth = {
	verify: async (token: string) => (token.startsWith("tok:") ? { id: token.slice(4), name: `name-${token.slice(4)}` } : null),
	guild: async (token: string, guildId: string) =>
		member[token.slice(4)]?.includes(guildId) ? (GUILDS[guildId] ?? null) : null,
};

let clock = 1_000_000;
let servers: GameServer[] = [];
function server(st: InstanceStore = store, extra: Partial<TGameServerDeps> = {}) {
	const gs = new GameServer({
		store: st,
		auth,
		eco,
		payments: { hasPass: async () => false, createRazorpayLink: async () => "", razorpayEnabled: false },
		dm: async () => {},
		log: quiet,
		now: () => clock,
		autoTick: false,
		...extra,
	});
	servers.push(gs);
	return gs;
}

beforeEach(async () => {
	await Promise.all(models.map((m) => m.deleteMany({})));
	for (const k of Object.keys(member)) delete member[k];
	servers = [];
	clock = 1_000_000;
});

afterEach(async () => {
	for (const gs of servers) await gs.shutdown();
});

type TSock = { data: { connId: string; userId?: string }; send: ReturnType<typeof mock>; close: ReturnType<typeof mock> };
let connSeq = 0;
const sock = (): TSock => ({ data: { connId: `c${++connSeq}` }, send: mock((_: string) => {}), close: mock(() => {}) });
const sent = (ws: TSock) => ws.send.mock.calls.map((c) => JSON.parse(c[0] as string) as TServerMsg);
function last<K extends TServerMsg["t"]>(ws: TSock, t: K) {
	return sent(ws).filter((m) => m.t === t).at(-1) as Extract<TServerMsg, { t: K }> | undefined;
}
const welcome = (ws: TSock) => last(ws, "welcome")!.snapshot;
const raw = (m: unknown) => JSON.stringify(m);

async function join(gs: GameServer, userId: string, guildId: string | null = null) {
	const ws = sock();
	gs.open(ws as any);
	await gs.message(ws as any, raw({ t: "hello", v: 1, token: `tok:${userId}`, instanceId: "i-1", guildId }));
	return ws;
}

// Saved location in the open world, so hello places the player in a lobby (the saved one when given and open)
async function seedWorld(userId: string, x: number, y: number, lobby?: number, facing: TDir = "d") {
	await store.savePlayers([
		{
			userId,
			name: userId,
			colour: "#fff",
			energy: MAX_ENERGY,
			lastEnergyAt: 0,
			equipped: "hoe",
			x,
			y,
			facing,
			location: { instanceKind: "world", ...(lobby === undefined ? {} : { lobby }), x, y, facing },
		},
	]);
}

const seqs = new Map<TSock, number>();
// Holds a direction for n ticks, sending a fresh input before each one
function hold(gs: GameServer, ws: TSock, dx: number, dy: number, n: number) {
	for (let i = 0; i < n; i++) {
		const seq = (seqs.get(ws) ?? 0) + 1;
		seqs.set(ws, seq);
		void gs.message(ws as any, raw({ t: "input", seq, dx, dy }));
		clock += TICK_MS;
		gs.tick();
	}
}

// Fills a lobby with session-less players until it holds `count`
function fill(inst: TInstance, count: number) {
	for (let i = 0; inst.players.size < count; i++)
		enter(inst, { userId: `fake-${inst.id}-${i}`, name: "f", energy: 1, lastEnergyAt: 0, equipped: "hoe", colour: "#000" });
}

const playersAbout = (ws: TSock, userId: string) => sent(ws).filter((m) => m.t === "player" && m.p.userId === userId);
const leftAbout = (ws: TSock, userId: string) => sent(ws).filter((m) => m.t === "left" && m.userId === userId);

describe("sessions", () => {
	test("hello with bad token closes socket", async () => {
		const gs = server();
		const ws = sock();
		gs.open(ws as any);
		await gs.message(ws as any, raw({ t: "hello", v: 1, token: "bad", instanceId: "i", guildId: null }));
		expect(ws.close).toHaveBeenCalled();
		expect(last(ws, "welcome")).toBeUndefined();

		// Anything but hello first also closes
		const ws2 = sock();
		gs.open(ws2 as any);
		await gs.message(ws2 as any, raw({ t: "input", seq: 1, dx: 1, dy: 0 }));
		expect(ws2.close).toHaveBeenCalled();
	});

	test("hello creates player on own land and sends welcome", async () => {
		const gs = server();
		const ws = await join(gs, "u1");
		const snap = welcome(ws);
		expect(snap.instance.kind).toBe("land");
		expect(snap.instance.ownerId).toBe("u1");
		expect(snap.instance.lobby).toBeNull();
		expect(snap.instance.unlocked).toHaveLength(9);
		expect(snap.you).toMatchObject({ userId: "u1", name: "name-u1", x: LAND_SPAWN.x + 0.5, y: LAND_SPAWN.y + 0.5, equipped: "hoe" });
		expect(last(ws, "wallet")).toMatchObject({ coins: 500, energy: MAX_ENERGY, inventory: { parsnip_seed: 15 } });

		gs.close(ws as any);
		await join(gs, "u1");
		expect((await eco.wallet("u1")).coins).toBe(500);
		expect(await LedgerEntry.countDocuments({ idempotencyKey: "starter:u1" })).toBe(1);
	});

	test("second connection replaces the first", async () => {
		const gs = server();
		const ws1 = await join(gs, "u1");
		const ws2 = await join(gs, "u1");
		expect(last(ws1, "kicked")).toEqual({ t: "kicked", reason: "opened elsewhere" });
		expect(ws1.close).toHaveBeenCalled();
		expect(last(ws2, "welcome")).toBeDefined();
		const inst = gs.instance(welcome(ws2).instance.id)!;
		expect([...inst.players.keys()]).toEqual(["u1"]);
		// The old socket's close event arrives later and must not remove the new session
		gs.close(ws1 as any);
		expect(inst.players.has("u1")).toBe(true);
		hold(gs, ws2, 1, 0, 1);
		expect(last(ws2, "you")).toBeDefined();
		expect(last(ws1, "you")).toBeUndefined();
	});

	test("input spam does not speed up the player", async () => {
		const gs = server();
		const ws = await join(gs, "u1");
		const x0 = welcome(ws).you.x;
		for (let seq = 1; seq <= 100; seq++) await gs.message(ws as any, raw({ t: "input", seq, dx: 1, dy: 0 }));
		clock += TICK_MS;
		gs.tick();
		const you = last(ws, "you")!;
		expect(you.ack).toBe(100);
		expect(you.x).toBeGreaterThan(x0);
		expect(you.x - x0).toBeLessThanOrEqual((WALK_SPEED * TICK_MS) / 1000 + 1e-9);
		// An old seq is ignored, and input older than INPUT_STALE_MS stops the player
		await gs.message(ws as any, raw({ t: "input", seq: 50, dx: -1, dy: 0 }));
		clock += 300;
		gs.tick();
		expect(gs.instance(welcome(ws).instance.id)!.players.get("u1")!.x).toBe(you.x);
	});

	test("closes socket after repeated garbage", async () => {
		const gs = server();
		const ws = await join(gs, "u1");
		// Messages for later tasks get a toast and are not counted as invalid
		for (let i = 0; i < 25; i++) await gs.message(ws as any, raw({ t: "emote", id: "wave" }));
		expect(last(ws, "toast")).toEqual({ t: "toast", msg: "Not available yet.", ok: false });
		for (let i = 0; i < 19; i++) await gs.message(ws as any, i % 2 ? "not json" : raw({ t: "buy", item: "wood", qty: -5 }));
		expect(ws.close).not.toHaveBeenCalled();
		await gs.message(ws as any, raw({ t: "nope" }));
		expect(ws.close).toHaveBeenCalled();
	});

	test("rejoin after restart restores position", async () => {
		const gs = server();
		const ws = await join(gs, "u1");
		hold(gs, ws, 1, 0, 5);
		const moved = last(ws, "you")!;
		expect(moved.x).toBeGreaterThan(LAND_SPAWN.x + 0.5);
		await gs.shutdown();
		expect(last(ws, "kicked")).toEqual({ t: "kicked", reason: "server restarting" });
		expect(ws.close).toHaveBeenCalled();

		const gs2 = server();
		const ws2 = await join(gs2, "u1");
		expect(welcome(ws2).you).toMatchObject({ x: moved.x, y: moved.y, facing: "r" });
	});

	test("close during a pending hello leaves nothing behind", async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		class GatedStore extends InstanceStore {
			override async getOrCreateLand(ownerId: string, slot = 0) {
				await gate;
				return super.getOrCreateLand(ownerId, slot);
			}
		}
		const gs = server(new GatedStore(eco, quiet));
		const ws = sock();
		gs.open(ws as any);
		const pending = gs.message(ws as any, raw({ t: "hello", v: 1, token: "tok:u1", instanceId: "i", guildId: null }));
		// A message while hello is pending is refused with a reason
		const ws2 = sock();
		gs.open(ws2 as any);
		const pending2 = gs.message(ws2 as any, raw({ t: "hello", v: 1, token: "tok:u2", instanceId: "i", guildId: null }));
		await gs.message(ws2 as any, raw({ t: "lobbies" }));
		expect(last(ws2, "kicked")).toEqual({ t: "kicked", reason: "wait for welcome" });
		expect(ws2.close).toHaveBeenCalled();

		gs.close(ws as any);
		release();
		await pending;
		await pending2;
		expect(last(ws, "welcome")).toBeUndefined();
		expect(last(ws2, "welcome")).toBeUndefined();
		const land = await Land.findOne({ ownerId: "u1" }).lean();
		const id = `land:${land!.landId}`;
		expect(gs.instance(id)!.players.size).toBe(0);
		clock += 5 * 60_000;
		gs.tick();
		expect(gs.instance(id)).toBeUndefined();
		// No session is left: a new hello gets a welcome and nobody is kicked
		const ws3 = await join(gs, "u1");
		expect(last(ws3, "welcome")).toBeDefined();
		expect(last(ws, "kicked")).toBeUndefined();
	});

	test("shutdown unloads every land", async () => {
		const gs = server();
		const ws = await join(gs, "u1");
		const { id, seed } = welcome(ws).instance;
		hold(gs, ws, 1, 0, 1);
		expect(cachedChunkCount(seed)).toBeGreaterThan(0);
		await gs.shutdown();
		expect(gs.instance(id)).toBeUndefined();
		expect(cachedChunkCount(seed)).toBe(0);
	});

	test("empty land unloads after 5 minutes", async () => {
		const gs = server();
		const ws = await join(gs, "u1");
		const { id, seed } = welcome(ws).instance;
		hold(gs, ws, 1, 0, 1);
		expect(cachedChunkCount(seed)).toBeGreaterThan(0);
		gs.close(ws as any);
		clock += 5 * 60_000 - 1;
		gs.tick();
		expect(gs.instance(id)).toBeDefined();
		clock += 1;
		gs.tick();
		expect(gs.instance(id)).toBeUndefined();
		expect(cachedChunkCount(seed)).toBe(0);
	});
});

describe("area of interest", () => {
	test("nearby players see moves", async () => {
		await seedWorld("a", 0.5, -0.5);
		await seedWorld("b", 3.5, -0.5);
		const gs = server();
		const a = await join(gs, "a");
		const b = await join(gs, "b");
		expect(welcome(b).players.map((p) => p.userId)).toEqual(["a"]);
		expect(playersAbout(a, "b")).toHaveLength(1); // b joined
		hold(gs, b, 1, 0, 1);
		const moved = playersAbout(a, "b");
		expect(moved).toHaveLength(2);
		expect((moved[1] as Extract<TServerMsg, { t: "player" }>).p.x).toBeGreaterThan(3.5);
	});

	test("players outside AOI see nothing", async () => {
		// The road at y = -1 runs east from town
		await seedWorld("a", 0.5, -0.5);
		await seedWorld("b", 3 * CHUNK + 0.5, -0.5); // chunk 3: just outside a's AOI
		await seedWorld("c", 200.5, -0.5);
		const gs = server();
		const a = await join(gs, "a");
		const b = await join(gs, "b");
		const c = await join(gs, "c");
		expect(welcome(b).players).toEqual([]);
		expect(welcome(c).players).toEqual([]);

		hold(gs, c, -1, 0, 2);
		expect(playersAbout(a, "c")).toEqual([]);
		expect(playersAbout(b, "c")).toEqual([]);

		// b steps west into chunk 2, inside a's AOI, then back out
		hold(gs, b, -1, 0, 3);
		expect(playersAbout(a, "b").length).toBeGreaterThan(0);
		expect(playersAbout(b, "a")).toHaveLength(1);
		hold(gs, b, 1, 0, 1);
		expect(leftAbout(a, "b")).toHaveLength(1);
		expect(leftAbout(b, "a")).toHaveLength(1);
		expect(playersAbout(c, "a")).toEqual([]);
		expect(playersAbout(c, "b")).toEqual([]);
	});

	test("entering a chunk sends its changed tiles", async () => {
		await seedWorld("a", 0.5, -0.5);
		const gs = server();
		const a = await join(gs, "a");
		const inst = gs.instance("lobby:1")!;
		// A tree in chunk x = 3, outside a's AOI until a reaches chunk 1
		let key = "";
		for (let y = -CHUNK; y < CHUNK && !key; y++)
			for (let x = 3 * CHUNK; x < 4 * CHUNK && !key; x++) if (worldTerrain(x, y) === T.tree) key = `${x},${y}`;
		expect(key).not.toBe("");
		inst.tiles.set(key, { wateredDays: [], regrowAt: clock + TREE_REGROW_MS });
		gs.tilesChanged(inst, [key]);
		const tilesWith = () => sent(a).filter((m) => m.t === "tiles" && m.tiles.some(([k]) => k === key));
		expect(tilesWith()).toEqual([]);

		hold(gs, a, 1, 0, Math.ceil((CHUNK - 0.5) / ((WALK_SPEED * TICK_MS) / 1000)) + 1);
		expect(Math.floor(inst.players.get("a")!.x / CHUNK)).toBe(1);
		expect(tilesWith()).toHaveLength(1);
	});
});

describe("lobbies", () => {
	test("home lobby per guild", async () => {
		member.a = ["G"];
		member.b = ["G"];
		member.c = ["H"];
		for (const u of ["a", "b", "c"]) await seedWorld(u, 0.5, -0.5);
		const gs = server();
		const a = welcome(await join(gs, "a", "G")).instance.lobby;
		const b = welcome(await join(gs, "b", "G")).instance.lobby;
		const c = welcome(await join(gs, "c", "H")).instance.lobby;
		expect(a).toEqual({ n: 2, label: "Home · G-name" });
		expect(b).toEqual(a);
		expect(c).toEqual({ n: 3, label: "Home · H-name" });
	});

	test("spoofed guildId is ignored", async () => {
		await seedWorld("d", 0.5, -0.5);
		const gs = server();
		const snap = welcome(await join(gs, "d", "G"));
		expect(snap.instance.lobby).toEqual({ n: 1, label: "Public" });
	});

	test("lobbies cap at 100", async () => {
		member.a = ["G"];
		member.e = ["G"];
		for (const u of ["a", "e", "f"]) await seedWorld(u, 0.5, -0.5);
		const gs = server();
		expect(welcome(await join(gs, "a", "G")).instance.lobby!.n).toBe(2);
		fill(gs.instance("lobby:2")!, LOBBY_CAP);
		// The home lobby is full, so e goes to the public lobby
		expect(welcome(await join(gs, "e", "G")).instance.lobby!.n).toBe(1);
		fill(gs.instance("lobby:1")!, LOBBY_CAP);
		// Every public lobby is full, so a new one opens at the next free number
		expect(welcome(await join(gs, "f")).instance.lobby).toEqual({ n: 3, label: "Public" });
	});

	test("lobby numbers are reused", async () => {
		member.a = ["G"];
		member.c = ["H"];
		member.k = ["K"];
		for (const u of ["a", "c", "k"]) await seedWorld(u, 0.5, -0.5);
		const gs = server();
		const a = await join(gs, "a", "G");
		await join(gs, "c", "H");
		gs.close(a as any);
		clock += 60_000 - 1;
		gs.tick();
		expect(gs.instance("lobby:2")).toBeDefined();
		clock += 1;
		gs.tick();
		expect(gs.instance("lobby:2")).toBeUndefined();
		expect(gs.instance("lobby:3")).toBeDefined();
		expect(gs.instance("lobby:1")).toBeDefined();
		expect(welcome(await join(gs, "k", "K")).instance.lobby).toEqual({ n: 2, label: "Home · K-name" });
	});

	test("reconnect keeps the switched lobby", async () => {
		member.b = ["G"];
		await seedWorld("a", 0.5, -0.5);
		await seedWorld("b", 5.5, -0.5);
		const gs = server();
		const a = await join(gs, "a");
		await join(gs, "b", "G");
		await gs.message(a as any, raw({ t: "switchLobby", lobby: 2 }));
		expect(welcome(a).instance.lobby!.n).toBe(2);
		// Replacing a live session
		const a2 = await join(gs, "a");
		expect(welcome(a2).instance.lobby!.n).toBe(2);
		// Reloading after the socket closed
		gs.close(a2 as any);
		const a3 = await join(gs, "a");
		expect(welcome(a3).instance.lobby!.n).toBe(2);
	});

	test("saved lobby that no longer exists falls back to placement", async () => {
		member.g = ["G"];
		await seedWorld("p", 0.5, -0.5, 7);
		await seedWorld("g", 0.5, -0.5, 9);
		const gs = server();
		expect(welcome(await join(gs, "p")).instance.lobby).toEqual({ n: 1, label: "Public" });
		expect(welcome(await join(gs, "g", "G")).instance.lobby).toEqual({ n: 2, label: "Home · G-name" });
	});

	test("switchLobby keeps position and rejects full or missing lobbies", async () => {
		member.b = ["G"];
		await seedWorld("a", 0.5, -0.5);
		await seedWorld("b", 5.5, -0.5);
		const gs = server();
		const a = await join(gs, "a");
		await join(gs, "b", "G");

		await gs.message(a as any, raw({ t: "lobbies" }));
		expect(last(a, "lobbyList")).toEqual({
			t: "lobbyList",
			current: 1,
			lobbies: [
				{ n: 1, label: "Public", players: 1, home: false },
				{ n: 2, label: "Home · G-name", players: 1, home: true },
			],
		});

		await gs.message(a as any, raw({ t: "switchLobby", lobby: 2 }));
		const snap = welcome(a);
		expect(snap.instance.lobby).toEqual({ n: 2, label: "Home · G-name" });
		expect(snap.you).toMatchObject({ x: 0.5, y: -0.5 });
		expect(snap.players.map((p) => p.userId)).toEqual(["b"]);
		expect(gs.instance("lobby:1")!.players.has("a")).toBe(false);

		await gs.message(a as any, raw({ t: "switchLobby", lobby: 7 }));
		expect(last(a, "toast")).toEqual({ t: "toast", msg: "No lobby #7.", ok: false });
		fill(gs.instance("lobby:1")!, LOBBY_CAP);
		await gs.message(a as any, raw({ t: "switchLobby", lobby: 1 }));
		expect(last(a, "toast")).toEqual({ t: "toast", msg: "Lobby #1 is full.", ok: false });
		expect(gs.instance("lobby:2")!.players.has("a")).toBe(true);

		// From private land, switching goes to the lobby's town spawn
		const l = await join(gs, "l");
		await gs.message(l as any, raw({ t: "switchLobby", lobby: 2 }));
		expect(welcome(l).instance.lobby!.n).toBe(2);
		expect(welcome(l).you).toMatchObject({ x: TOWN_SPAWN.x + 0.5, y: TOWN_SPAWN.y + 0.5 });
	});

	test("lobby regrowth state is separate", async () => {
		member.a = ["G"];
		await seedWorld("a", 0.5, -0.5);
		const gs = server();
		await join(gs, "a", "G");
		const one = gs.instance("lobby:1")!;
		const two = gs.instance("lobby:2")!;
		// Standing below the field at (-3, -56), facing it
		const base = { userId: "t", name: "t", energy: MAX_ENERGY, lastEnergyAt: clock, equipped: "hoe", colour: "#000" };
		for (const inst of [one, two]) expect(enter(inst, base, { x: -2.5, y: -54.5, facing: "u" }).y).toBe(-54.5);

		const r = use(one, "t", clock, {});
		expect(r.ok).toBe(true);
		expect(r.give).toBeDefined();
		r.apply!();
		expect(use(one, "t", clock, {}).msg).toBe("This is still growing.");
		expect(use(two, "t", clock, {}).ok).toBe(true);
		expect(two.tiles.size).toBe(0);
	});
});

describe("animals", () => {
	afterEach(() => mock.restore());

	// Homes of two rabbits more than two AOI widths apart, both outside town
	const homes: { x: number; y: number }[] = [];
	for (let cy = -WORLD_CHUNKS / 2; cy < WORLD_CHUNKS / 2 && homes.length < 2; cy++)
		for (let cx = -WORLD_CHUNKS / 2; cx < WORLD_CHUNKS / 2 && homes.length < 2; cx++) {
			const r = entities.spawnAnimals(cx, cy).find((a) => a.kind === "rabbit");
			if (r && homes.every((h) => Math.abs(chunkOf(h.x, h.y).cx - cx) > 5)) homes.push({ x: r.homeX, y: r.homeY });
		}
	const [A, B] = homes as [{ x: number; y: number }, { x: number; y: number }];
	const chebyshev = (a: { x: number; y: number }, b: { x: number; y: number }) => {
		const ca = chunkOf(a.x, a.y);
		const cb = chunkOf(b.x, b.y);
		return Math.max(Math.abs(ca.cx - cb.cx), Math.abs(ca.cy - cb.cy));
	};
	const entsOf = (ws: TSock) => sent(ws).filter((m) => m.t === "ents") as Extract<TServerMsg, { t: "ents" }>[];
	const step = (gs: GameServer) => {
		clock += TICK_MS;
		gs.tick();
	};
	// Puts a living rabbit of `instId` on the player's faced point
	const rabbitInFront = (gs: GameServer, instId: string, userId: string) => {
		const p = gs.instance(instId)!.players.get(userId)!;
		const r = gs.animals(instId).find((a) => a.kind === "rabbit" && a.state !== "dead")!;
		r.x = p.x;
		r.y = p.y + 0.8; // facing down
		return r;
	};

	test("ents only within AOI", async () => {
		await seedWorld("a", A.x, A.y);
		await seedWorld("b", B.x, B.y);
		const gs = server();
		const a = await join(gs, "a");
		const b = await join(gs, "b");
		step(gs);
		const ea = last(a, "ents")!.ents;
		const eb = last(b, "ents")!.ents;
		expect(ea.length).toBeGreaterThan(0);
		expect(eb.length).toBeGreaterThan(0);
		for (const [, , x, y] of ea) expect(chebyshev({ x, y }, A)).toBeLessThanOrEqual(2);
		for (const [, , x, y] of eb) expect(chebyshev({ x, y }, B)).toBeLessThanOrEqual(2);
		// Exactly the living animals in a's AOI
		const inAoi = gs.animals("lobby:1").filter((an) => an.state !== "dead" && chebyshev(an, A) <= 2);
		expect(ea.map(([id]) => id).sort()).toEqual(inAoi.map((an) => an.id).sort());
		expect(ea.some(([id]) => eb.some(([o]) => o === id))).toBe(false);

		// Nothing moves: no message
		spyOn(entities, "tickAnimal").mockImplementation(() => {});
		const n = entsOf(a).length;
		step(gs);
		expect(entsOf(a)).toHaveLength(n);
		// One animal moves: a new list
		const moved = gs.animals("lobby:1").find((an) => an.id === ea[0]![0])!;
		moved.x += 0.25;
		step(gs);
		expect(entsOf(a)).toHaveLength(n + 1);
		expect(last(a, "ents")!.ents.find(([id]) => id === moved.id)![2]).toBeCloseTo(moved.x, 2);
		expect(entsOf(b)).toHaveLength(1);
	});

	test("inactive chunks are not simulated", async () => {
		await seedWorld("a", A.x, A.y);
		const gs = server();
		const a = await join(gs, "a");
		const spy = spyOn(entities, "tickAnimal");
		step(gs);
		const loaded = gs.animals("lobby:1");
		expect(loaded.length).toBeGreaterThan(0);
		expect(spy).toHaveBeenCalledTimes(loaded.length);
		for (const an of loaded) expect(chebyshev({ x: an.homeX, y: an.homeY }, A)).toBeLessThanOrEqual(2);
		gs.close(a as any);
		spy.mockClear();
		step(gs);
		expect(spy).not.toHaveBeenCalled();
		expect(gs.animals("lobby:1")).toHaveLength(loaded.length);
	});

	test("animals despawn 60 s after chunk goes inactive", async () => {
		await seedWorld("a", A.x, A.y);
		const gs = server();
		const a = await join(gs, "a");
		step(gs);
		expect(gs.animals("lobby:1").length).toBeGreaterThan(0);
		gs.close(a as any);
		step(gs);
		clock += 60_000 - 1;
		gs.tick();
		expect(gs.animals("lobby:1").length).toBeGreaterThan(0);
		clock += 1;
		gs.tick();
		expect(gs.animals("lobby:1")).toEqual([]);
	});

	test("slaughter credits drops to the hitter's inventory through EconomyManager", async () => {
		await seedWorld("a", A.x, A.y);
		const gs = server();
		const a = await join(gs, "a");
		step(gs);
		spyOn(entities, "tickAnimal").mockImplementation(() => {});
		const p = gs.instance("lobby:1")!.players.get("a")!;
		const energy = p.energy;
		const r = rabbitInFront(gs, "lobby:1", "a");
		expect(await gs.hitAnimal("a", r.id)).toMatchObject({ ok: true, drops: { raw_meat: 1, hide: 1 } });
		expect(await eco.inventory("a")).toMatchObject({ raw_meat: 1, hide: 1 });
		expect(await LedgerEntry.countDocuments({ reason: "slaughter", ref: "rabbit" })).toBe(1);
		expect(last(a, "wallet")!.inventory).toMatchObject({ raw_meat: 1, hide: 1 });
		// engine use() charges the energy, not this
		expect(p.energy).toBe(energy);
		// Dead: not hittable, not sent
		expect((await gs.hitAnimal("a", r.id)).ok).toBe(false);
		step(gs);
		expect(last(a, "ents")!.ents.some(([id]) => id === r.id)).toBe(false);
		// Out of reach, or no such animal
		const other = gs.animals("lobby:1").find((an) => an.state !== "dead")!;
		other.x = p.x + 3;
		other.y = p.y;
		expect((await gs.hitAnimal("a", other.id)).ok).toBe(false);
		expect((await gs.hitAnimal("a", 12345)).ok).toBe(false);
		expect(await eco.inventory("a")).toMatchObject({ raw_meat: 1, hide: 1 });
	});

	test("slaughter works in lobbies; no wild animals spawn on private land", async () => {
		member.b = ["G"];
		await seedWorld("a", A.x, A.y);
		await seedWorld("b", A.x, A.y);
		const gs = server();
		await join(gs, "a");
		await join(gs, "b", "G");
		step(gs);
		spyOn(entities, "tickAnimal").mockImplementation(() => {});
		// Each lobby has its own copy of the same animals
		const ra = rabbitInFront(gs, "lobby:1", "a");
		const rb = rabbitInFront(gs, "lobby:2", "b");
		expect(rb.id).toBe(ra.id);
		expect((await gs.hitAnimal("a", ra.id)).ok).toBe(true);
		expect(rb.state).not.toBe("dead");
		expect((await gs.hitAnimal("b", rb.id)).ok).toBe(true);
		expect(await eco.inventory("b")).toMatchObject({ raw_meat: 1, hide: 1 });

		const l = await join(gs, "l");
		const landId = welcome(l).instance.id;
		step(gs);
		expect(gs.animals(landId)).toEqual([]);
		expect(entsOf(l)).toEqual([]);
		expect((await gs.hitAnimal("l", ra.id)).ok).toBe(false);
	});
});

describe("actions", () => {
	afterEach(() => mock.restore());

	// Land epochs are real time, so day-based rules need the test clock just after now
	beforeEach(() => {
		clock = Date.now() + 60_000;
	});

	const toasts = (ws: TSock) => sent(ws).filter((m) => m.t === "toast") as Extract<TServerMsg, { t: "toast" }>[];
	const instOf = (gs: GameServer, ws: TSock) => gs.instance(welcome(ws).instance.id)!;
	// Moves the player in place (same chunk as where it joined) to face a tile
	const put = (gs: GameServer, ws: TSock, userId: string, x: number, y: number, facing: TDir) => {
		const p = instOf(gs, ws).players.get(userId)!;
		p.x = x;
		p.y = y;
		p.facing = facing;
		return p;
	};
	const act = (gs: GameServer, ws: TSock, m: unknown) => gs.message(ws as any, raw(m));
	// Home of the first rabbit: wild animals spawn around it
	const WILD = (() => {
		for (let cy = -WORLD_CHUNKS / 2; cy < WORLD_CHUNKS / 2; cy++)
			for (let cx = -WORLD_CHUNKS / 2; cx < WORLD_CHUNKS / 2; cx++) {
				const r = entities.spawnAnimals(cx, cy).find((an) => an.kind === "rabbit");
				if (r) return { x: r.homeX, y: r.homeY };
			}
		throw new Error("no rabbit");
	})();
	let useSeq = 0;
	const useMsg = () => ({ t: "use", seq: ++useSeq });

	test("till, plant, water, harvest on own land", async () => {
		const gs = server();
		const ws = await join(gs, "u1");
		const inst = instOf(gs, ws);
		// Spawn faces down onto cleared grass
		const key = `${LAND_SPAWN.x},${LAND_SPAWN.y + 1}`;
		const landId = welcome(ws).instance.id.slice("land:".length);

		await act(gs, ws, useMsg());
		expect(last(ws, "toast")).toEqual({ t: "toast", msg: "You till the soil.", ok: true });
		expect(inst.tiles.get(key)?.tilled).toBe(true);
		expect(last(ws, "tiles")!.tiles).toEqual([[key, { tilled: true, wateredDays: [] }]]);
		expect(await LandTile.findOne({ landId, x: LAND_SPAWN.x, y: LAND_SPAWN.y + 1 }).lean()).toMatchObject({ tilled: true });
		expect(last(ws, "wallet")!.energy).toBe(MAX_ENERGY - 2);

		await act(gs, ws, { t: "equip", item: "parsnip_seed" });
		await act(gs, ws, useMsg());
		expect(inst.tiles.get(key)?.cropId).toBe("parsnip");
		expect(await eco.inventory("u1")).toMatchObject({ parsnip_seed: 14 });
		expect(last(ws, "wallet")!.inventory.parsnip_seed).toBe(14);
		expect((await LandTile.findOne({ landId, x: LAND_SPAWN.x, y: LAND_SPAWN.y + 1 }).lean())?.cropId).toBe("parsnip");

		// Parsnips grow in 2 watered days
		await act(gs, ws, { t: "equip", item: "watering_can" });
		for (let d = 0; d < 2; d++) {
			await act(gs, ws, useMsg());
			expect(last(ws, "toast")!.msg).toBe("💧 Watered.");
			clock += DAY_MS;
		}
		await act(gs, ws, useMsg());
		expect(last(ws, "toast")!.msg).toContain("Harvested 1 Parsnip");
		expect(await eco.inventory("u1")).toMatchObject({ parsnip: 1, parsnip_seed: 14 });
		expect(inst.tiles.get(key)).toEqual({ tilled: true, wateredDays: [] });
		expect(last(ws, "wallet")!.inventory.parsnip).toBe(1);
	});

	test("planting fails cleanly without seeds", async () => {
		const gs = server();
		const ws = await join(gs, "u1");
		await act(gs, ws, useMsg());
		await act(gs, ws, { t: "equip", item: "parsnip_seed" });
		// The seeds are gone after equipping, as if sold elsewhere
		await eco.transact([{ userId: "u1", items: { parsnip_seed: -15 } }], { reason: "test" });
		await act(gs, ws, useMsg());
		expect(last(ws, "toast")!.ok).toBe(false);
		expect(instOf(gs, ws).tiles.get(`${LAND_SPAWN.x},${LAND_SPAWN.y + 1}`)?.cropId).toBeUndefined();
	});

	test("equip only tools and owned items, and observers see it", async () => {
		await seedWorld("a", 0.5, -0.5);
		await seedWorld("b", 2.5, -0.5);
		const gs = server();
		const a = await join(gs, "a");
		const b = await join(gs, "b");
		await act(gs, a, { t: "equip", item: "axe" });
		expect(instOf(gs, a).players.get("a")!.equipped).toBe("axe");
		expect(playersAbout(b, "a").at(-1)).toMatchObject({ p: { equipped: "axe" } });
		await act(gs, a, { t: "equip", item: "gold" });
		expect(last(a, "toast")).toEqual({ t: "toast", msg: "You don't have any Gold Ore.", ok: false });
		await act(gs, a, { t: "equip", item: "nope" });
		expect(last(a, "toast")).toEqual({ t: "toast", msg: "Unknown item.", ok: false });
		expect(instOf(gs, a).players.get("a")!.equipped).toBe("axe");
	});

	test("use is rate limited to 6/s", async () => {
		const gs = server();
		const ws = await join(gs, "u1");
		const n = toasts(ws).length;
		for (let i = 0; i < 9; i++) await act(gs, ws, useMsg());
		const got = toasts(ws).slice(n);
		expect(got.filter((t) => t.msg === "Slow down.")).toHaveLength(1);
		expect(got.filter((t) => t.msg !== "Slow down.")).toHaveLength(6);
		// The window slides: a second later actions run again
		clock += 1000;
		await act(gs, ws, { t: "sleep" });
		expect(last(ws, "toast")!.msg).toBe("Face your house door to sleep.");
	});

	test("sleep restores energy at your house door after 18:00", async () => {
		const gs = server();
		const ws = await join(gs, "u1");
		const p = put(gs, ws, "u1", HOUSE_DOOR.x + 0.5, HOUSE_DOOR.y + 1.5, "u");
		p.energy = 3;
		p.lastEnergyAt = clock;
		await act(gs, ws, { t: "sleep" });
		expect(last(ws, "toast")!.ok).toBe(false);
		clock = instOf(gs, ws).epoch + 12 * 60_000;
		await act(gs, ws, { t: "sleep" });
		expect(last(ws, "toast")).toEqual({ t: "toast", msg: "💤 You feel rested. Energy restored!", ok: true });
		expect(p.energy).toBe(MAX_ENERGY);
		expect(last(ws, "wallet")!.energy).toBe(MAX_ENERGY);
	});

	test("travel moves player between land and world", async () => {
		// Below the Land Gate, facing it
		const gx = LAND_GATE.x + 0.5;
		const gy = LAND_GATE.y + 1.5;
		await seedWorld("a", gx, gy, undefined, "u");
		await seedWorld("b", gx + 1, gy);
		const gs = server();
		const a = await join(gs, "a");
		const b = await join(gs, "b");
		expect(welcome(a).you).toMatchObject({ x: gx, y: gy });

		await act(gs, a, { t: "travel", to: "land" });
		expect(welcome(a).instance).toMatchObject({ kind: "land", ownerId: "a" });
		expect(welcome(a).you).toMatchObject({ x: LAND_SPAWN.x + 0.5, y: LAND_SPAWN.y + 0.5 });
		expect(leftAbout(b, "a")).toHaveLength(1);
		expect(gs.instance("lobby:1")!.players.has("a")).toBe(false);

		// Back through the portal stone, by using it: to the same lobby and spot
		put(gs, a, "a", LAND_PORTAL.x + 1.5, LAND_PORTAL.y + 0.5, "l");
		await act(gs, a, useMsg());
		expect(welcome(a).instance.id).toBe("lobby:1");
		expect(welcome(a).you).toMatchObject({ x: gx, y: gy, facing: "u" });
		expect(playersAbout(b, "a").length).toBeGreaterThan(0);

		// A player with no world position arrives at TOWN_SPAWN
		const c = await join(gs, "c");
		put(gs, c, "c", HOUSE_DOOR.x + 0.5, HOUSE_DOOR.y + 1.5, "u");
		await act(gs, c, { t: "travel", to: "world" });
		expect(welcome(c).instance.kind).toBe("world");
		expect(welcome(c).you).toMatchObject({ x: TOWN_SPAWN.x + 0.5, y: TOWN_SPAWN.y + 0.5 });
	});

	test("travel only from a portal tile or the house door", async () => {
		const gs = server();
		const ws = await join(gs, "u1");
		const id = welcome(ws).instance.id;
		await act(gs, ws, { t: "travel", to: "world" });
		expect(last(ws, "toast")).toEqual({ t: "toast", msg: "Use the portal stone or your house door to travel.", ok: false });
		// Facing the portal, but asking for the wrong place
		put(gs, ws, "u1", LAND_PORTAL.x + 1.5, LAND_PORTAL.y + 0.5, "l");
		await act(gs, ws, { t: "travel", to: "land" });
		expect(last(ws, "toast")!.ok).toBe(false);
		expect(welcome(ws).instance.id).toBe(id);

		await seedWorld("w", 0.5, -0.5);
		const w = await join(gs, "w");
		await act(gs, w, { t: "travel", to: "land" });
		expect(last(w, "toast")).toEqual({ t: "toast", msg: "Use the Land Gate to go to your land.", ok: false });
		expect(welcome(w).instance.kind).toBe("world");
	});

	test("buy only while facing a shop door", async () => {
		await seedWorld("a", 0.5, -0.5);
		const gs = server();
		const ws = await join(gs, "a");
		await eco.transact([{ userId: "a", coins: 500, items: { parsnip_seed: 15 } }], { reason: "test" });
		await act(gs, ws, { t: "buy", item: "wheat_seed", qty: 2 });
		expect(last(ws, "toast")).toEqual({ t: "toast", msg: "Visit the General Store to buy.", ok: false });
		await act(gs, ws, { t: "sell", item: "parsnip_seed", qty: 1 });
		expect(last(ws, "toast")).toEqual({ t: "toast", msg: "Visit the General Store to sell.", ok: false });
		expect((await eco.wallet("a")).coins).toBe(500);

		const door = SHOP_DOORS[0]!;
		put(gs, ws, "a", door.x + 0.5, door.y + 1.5, "u");
		await act(gs, ws, { t: "buy", item: "wheat_seed", qty: 2 });
		expect(last(ws, "toast")!.ok).toBe(true);
		const coins = (await eco.wallet("a")).coins;
		expect(coins).toBeLessThan(500);
		expect(await eco.inventory("a")).toMatchObject({ wheat_seed: 2 });
		expect(last(ws, "wallet")).toMatchObject({ coins, inventory: { wheat_seed: 2 } });

		await act(gs, ws, { t: "sell", item: "parsnip_seed", qty: "all" });
		expect(last(ws, "toast")!.ok).toBe(true);
		expect((await eco.inventory("a")).parsnip_seed).toBeUndefined();
		expect((await eco.wallet("a")).coins).toBeGreaterThan(coins);
		await act(gs, ws, { t: "sell", item: "parsnip_seed", qty: "all" });
		expect(last(ws, "toast")).toEqual({ t: "toast", msg: "You have no Parsnip Seeds.", ok: false });
		await act(gs, ws, { t: "buy", item: "hoe", qty: 1 });
		expect(last(ws, "toast")!.ok).toBe(false);
	});

	test("unlock sends chunks to everyone on the land and wallet to the owner", async () => {
		const gs = server();
		const ws = await join(gs, "u1");
		await act(gs, ws, { t: "unlock", cx: 3, cy: 0 });
		expect(last(ws, "toast")).toEqual({ t: "toast", msg: "That chunk is not next to your land.", ok: false });
		await act(gs, ws, { t: "unlock", cx: 2, cy: 0 });
		expect(last(ws, "chunks")!.unlocked).toHaveLength(10);
		expect(last(ws, "chunks")!.unlocked).toContain("2,0");
		expect(last(ws, "wallet")!.coins).toBe(0);
		expect((await Land.findOne({ ownerId: "u1" }).lean())!.unlocked).toContain("2,0");
		// Not enough coins for the next one
		await act(gs, ws, { t: "unlock", cx: 2, cy: 1 });
		expect(last(ws, "toast")!.ok).toBe(false);
		expect(last(ws, "chunks")!.unlocked).toHaveLength(10);

		// Lobbies have nothing to unlock
		await seedWorld("w", 0.5, -0.5);
		const w = await join(gs, "w");
		await act(gs, w, { t: "unlock", cx: 2, cy: 0 });
		expect(last(w, "toast")).toEqual({ t: "toast", msg: "Only the owner can expand this land.", ok: false });
	});

	test("buyProduct DMs a Razorpay link and toasts Check your DMs", async () => {
		const dms: [string, string][] = [];
		const links: string[] = [];
		const gs = server(store, {
			payments: {
				hasPass: async () => false,
				razorpayEnabled: true,
				createRazorpayLink: async (_userId, product) => (links.push(product.id), "https://rzp.io/l/abc"),
			},
			dm: async (userId, content) => void dms.push([userId, content]),
		});
		const ws = await join(gs, "u1");
		await act(gs, ws, { t: "buyProduct", productId: "farm_pass" });
		expect(links).toEqual(["farm_pass"]);
		expect(dms).toHaveLength(1);
		expect(dms[0]![0]).toBe("u1");
		expect(dms[0]![1]).toContain("https://rzp.io/l/abc");
		expect(dms[0]![1]).toContain("Your item appears in game as soon as payment completes.");
		expect(last(ws, "toast")).toEqual({ t: "toast", msg: "Check your DMs to pay.", ok: true });

		// Gems are never sold, and unknown products are refused
		for (const productId of ["gems_100", "nope"]) {
			await act(gs, ws, { t: "buyProduct", productId });
			expect(last(ws, "toast")).toEqual({ t: "toast", msg: "That isn't for sale.", ok: false });
		}
		expect(dms).toHaveLength(1);
	});

	test("buyProduct sends one link per product per 30 s", async () => {
		const dms: string[] = [];
		const gs = server(store, {
			payments: { hasPass: async () => false, razorpayEnabled: true, createRazorpayLink: async () => "https://rzp.io/l/abc" },
			dm: async (_u, content) => void dms.push(content),
		});
		const ws = await join(gs, "u1");
		await act(gs, ws, { t: "buyProduct", productId: "farm_pass" });
		clock += 29_999;
		await act(gs, ws, { t: "buyProduct", productId: "farm_pass" });
		expect(last(ws, "toast")).toEqual({ t: "toast", msg: "Check your DMs — a link was sent recently.", ok: false });
		expect(dms).toHaveLength(1);
		clock += 1;
		await act(gs, ws, { t: "buyProduct", productId: "farm_pass" });
		expect(dms).toHaveLength(2);
	});

	test("buyProduct with Razorpay off toasts and DMs nothing", async () => {
		const dms: string[] = [];
		const gs = server(store, { dm: async (_u, content) => void dms.push(content) });
		const ws = await join(gs, "u1");
		await act(gs, ws, { t: "buyProduct", productId: "farm_pass" });
		expect(last(ws, "toast")).toEqual({ t: "toast", msg: "Purchases are not available right now.", ok: false });
		expect(dms).toEqual([]);
	});

	test("pushWallet sends wallet to an online player and is a no-op offline", async () => {
		const gs = server();
		const ws = await join(gs, "u1");
		const n = sent(ws).filter((m) => m.t === "wallet").length;
		await eco.transact([{ userId: "u1", gems: 7 }], { reason: "test" });
		await gs.pushWallet("u1");
		expect(sent(ws).filter((m) => m.t === "wallet")).toHaveLength(n + 1);
		expect(last(ws, "wallet")!.gems).toBe(12);
		gs.close(ws as any);
		await gs.pushWallet("u1");
		await gs.pushWallet("nobody");
		expect(sent(ws).filter((m) => m.t === "wallet")).toHaveLength(n + 1);
	});

	test("lobby regrowth through use: harvesting in #1 leaves #2 alone", async () => {
		// Standing below the field at (-3, -56), facing it
		member.b = ["G"];
		await seedWorld("a", -2.5, -54.5, undefined, "u");
		await seedWorld("b", -2.5, -54.5, undefined, "u");
		const gs = server();
		const a = await join(gs, "a");
		const b = await join(gs, "b", "G");
		expect(welcome(a).instance.id).toBe("lobby:1");
		expect(welcome(b).instance.id).toBe("lobby:2");

		await act(gs, a, useMsg());
		expect(last(a, "toast")!.msg).toContain("Harvested");
		expect(last(a, "tiles")!.tiles.map(([k]) => k)).toEqual(["-3,-56"]);
		await act(gs, a, useMsg());
		expect(last(a, "toast")).toEqual({ t: "toast", msg: "This is still growing.", ok: false });
		expect(last(b, "tiles")).toBeUndefined();

		await act(gs, b, useMsg());
		expect(last(b, "toast")!.msg).toContain("Harvested");
		const got = (await eco.inventory("a"));
		expect(await eco.inventory("b")).toEqual(got);
		// Lobby tiles are not saved
		expect(await LandTile.countDocuments({})).toBe(0);
	});

	test("use hits an animal in front and charges energy once", async () => {
		await seedWorld("a", WILD.x, WILD.y);
		const gs = server();
		const a = await join(gs, "a");
		clock += TICK_MS;
		gs.tick();
		spyOn(entities, "tickAnimal").mockImplementation(() => {});
		const p = gs.instance("lobby:1")!.players.get("a")!;
		const r = gs.animals("lobby:1").find((an) => an.state !== "dead")!;
		expect(r).toBeDefined();
		r.hp = 1;
		r.x = p.x;
		r.y = p.y + 0.8;
		const energy = p.energy;
		await act(gs, a, useMsg());
		expect(r.state).toBe("dead");
		expect(p.energy).toBe(energy - 2);
		expect(await eco.inventory("a")).toMatchObject(entities.ANIMAL_DROPS[r.kind]);
		expect(last(a, "toast")!.msg).toContain("🍖");
		expect(last(a, "wallet")!.energy).toBe(energy - 2);
	});

	test("a failed drop credit leaves the animal alive and charges nothing", async () => {
		await seedWorld("a", WILD.x, WILD.y);
		const gs = server();
		const a = await join(gs, "a");
		clock += TICK_MS;
		gs.tick();
		spyOn(entities, "tickAnimal").mockImplementation(() => {});
		const p = gs.instance("lobby:1")!.players.get("a")!;
		const r = gs.animals("lobby:1").find((an) => an.state !== "dead")!;
		r.hp = 1;
		r.x = p.x;
		r.y = p.y + 0.8;
		const before = { hp: r.hp, state: r.state, until: r.until };
		const energy = p.energy;
		spyOn(eco, "transact").mockImplementation(async () => {
			throw new Error("db down");
		});
		await act(gs, a, useMsg());
		expect({ hp: r.hp, state: r.state, until: r.until }).toEqual(before);
		expect(p.energy).toBe(energy);
		expect(last(a, "toast")).toEqual({ t: "toast", msg: "Couldn't collect the drops.", ok: false });
	});
});

describe("gems and energy", () => {
	const toastsOf = (ws: TSock) => sent(ws).filter((m) => m.t === "toast") as Extract<TServerMsg, { t: "toast" }>[];
	test("5 gems once per UTC day on the first hello", async () => {
		const gs = server();
		const ws = await join(gs, "u1");
		expect(last(ws, "toast")).toEqual({ t: "toast", msg: "Daily reward: +5 💎", ok: true });
		expect(last(ws, "wallet")!.gems).toBe(5);
		const day = new Date(clock).toISOString().slice(0, 10);
		expect(await LedgerEntry.countDocuments({ idempotencyKey: `daily-gems:u1:${day}` })).toBe(1);

		const ws2 = await join(gs, "u1");
		expect(last(ws2, "toast")).toBeUndefined();
		expect((await eco.wallet("u1")).gems).toBe(5);

		clock += 86_400_000;
		const ws3 = await join(gs, "u1");
		expect(last(ws3, "toast")!.msg).toBe("Daily reward: +5 💎");
		expect((await eco.wallet("u1")).gems).toBe(10);
	});

	// A world rock with walkable ground to its left
	const ROCK = (() => {
		for (let y = -60; y < 60; y++) for (let x = -60; x < 60; x++) if (worldTerrain(x, y) === T.rock && worldTerrain(x - 1, y) === T.grass) return { x, y };
		throw new Error("no rock");
	})();
	// Mines ROCK n times, waiting for it to regrow in between
	async function mine(gs: GameServer, ws: TSock, n: number) {
		for (let i = 0; i < n; i++) {
			await gs.message(ws as any, raw({ t: "use", seq: ++mineSeq }));
			clock += ROCK_REGROW_MS;
		}
	}
	let mineSeq = 0;
	async function miner(rand: () => number) {
		await seedWorld("a", ROCK.x - 0.5, ROCK.y + 0.5, undefined, "r");
		const gs = server(store, { rand });
		const ws = await join(gs, "a");
		expect(welcome(ws).you).toMatchObject({ x: ROCK.x - 0.5, y: ROCK.y + 0.5 });
		await gs.message(ws as any, raw({ t: "equip", item: "pickaxe" }));
		return { gs, ws };
	}

	test("mining gem drops are capped at 5 per day", async () => {
		const { gs, ws } = await miner(() => 0);
		expect((await eco.wallet("a")).gems).toBe(5); // the daily reward
		await mine(gs, ws, 10);
		expect((await eco.wallet("a")).gems).toBe(10);
		expect(last(ws, "wallet")!.gems).toBe(10);
		expect(toastsOf(ws).filter((t) => t.msg.includes("You found a gem"))).toHaveLength(5);
	});

	test("cap resets next UTC day", async () => {
		const { gs, ws } = await miner(() => 0);
		await mine(gs, ws, 6);
		expect((await eco.wallet("a")).gems).toBe(10);
		clock += 86_400_000;
		await mine(gs, ws, 6);
		expect((await eco.wallet("a")).gems).toBe(15);
	});

	test("re-mining a regrown lobby rock does not repeat a gem", async () => {
		const rolls = [0];
		const { gs, ws } = await miner(() => rolls.shift() ?? 0.5);
		await mine(gs, ws, 4);
		expect((await eco.wallet("a")).gems).toBe(6);
		expect(await eco.inventory("a")).not.toEqual({});
	});

	test("the daily cap holds under concurrent claims", async () => {
		const day = "2026-11-17";
		const got = await Promise.all(Array.from({ length: 12 }, () => store.claimOreGem("z", day, 5)));
		expect(got.filter((k) => k !== null).sort()).toEqual([1, 2, 3, 4, 5]);
		expect(await store.claimOreGem("z", "2026-11-18", 5)).toBe(1);
	});

	test("refillEnergy fills a live session, or the saved state offline", async () => {
		const gs = server();
		const ws = await join(gs, "u1");
		const p = gs.instance(welcome(ws).instance.id)!.players.get("u1")!;
		p.energy = 4;
		p.lastEnergyAt = clock;
		await gs.refillEnergy("u1");
		expect(p.energy).toBe(MAX_ENERGY);
		expect(last(ws, "wallet")!.energy).toBe(MAX_ENERGY);

		p.energy = 4;
		gs.close(ws as any);
		await gs.refillEnergy("u1");
		const saved = await PlayerState.findOne({ userId: "u1" }).lean();
		expect(saved!.energy).toBe(MAX_ENERGY);
		const ws2 = await join(gs, "u1");
		expect(last(ws2, "wallet")!.energy).toBe(MAX_ENERGY);

		// No saved state: nothing to refill, so the shop refuses before charging
		expect(await gs.hasPlayed("ghost")).toBe(false);
		expect(await gs.refillEnergy("ghost")).toBe(false);
		expect(await gs.hasPlayed("u1")).toBe(true);
	});
});
