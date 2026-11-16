import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, setDefaultTimeout, test } from "bun:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { CHUNK, LAND_SPAWN, cachedChunkCount } from "../game/chunks";
import { MAX_ENERGY, TICK_MS, TREE_REGROW_MS, WALK_SPEED, enter, use, type TDir, type TInstance } from "../game/engine";
import { T } from "../game/map";
import type { TServerMsg } from "../game/protocol";
import { TOWN_SPAWN, worldTerrain } from "../game/world";
import EconomyManager from "../managers/EconomyManager";
import GameServer, { LOBBY_CAP } from "../managers/GameServer";
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
function server() {
	const gs = new GameServer({
		store,
		auth,
		eco,
		payments: { hasPass: async () => false, createRazorpayLink: async () => "", razorpayEnabled: false },
		dm: async () => {},
		log: quiet,
		now: () => clock,
		autoTick: false,
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

// Saved location in the open world, so hello places the player in a lobby
async function seedWorld(userId: string, x: number, y: number, facing: TDir = "d") {
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
			location: { instanceKind: "world", lobby: 1, x, y, facing },
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
		for (let i = 0; i < 25; i++) await gs.message(ws as any, raw({ t: "sleep" }));
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
