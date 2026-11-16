import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import config from "../config";
import { PLOTS } from "../game/map";
import DatabaseManager from "../managers/DatabaseManager";
import EconomyManager from "../managers/EconomyManager";
import GameManager from "../managers/GameManager";
import RenderManager from "../managers/RenderManager";

setDefaultTimeout(60_000);
let replset: MongoMemoryReplSet;
const noop = () => {};
const client: any = {
	db: DatabaseManager,
	economy: new EconomyManager(),
	render: new RenderManager(),
	payments: { hasPass: async () => false },
	config,
	log: { info: noop, debug: noop, warn: noop, error: (e: unknown) => console.error(e) },
};
let game: GameManager;

function fakeInteraction(userId: string, name: string) {
	const edits: any[] = [];
	return {
		edits,
		guildId: "guild1",
		user: { id: userId, displayName: name },
		member: { displayName: name },
		inCachedGuild: () => true,
		deferReply: async () => {},
		deferUpdate: async () => {},
		reply: async (p: any) => edits.push(p),
		// Serialize like discord.js would before sending; throws on invalid components
		editReply: async (p: any) => edits.push({ ...p, json: p.components.map((c: any) => c.toJSON()) }),
		update: async (p: any) => edits.push({ ...p, json: p.components.map((c: any) => c.toJSON()) }),
	};
}
const lastText = (i: ReturnType<typeof fakeInteraction>) =>
	JSON.stringify(i.edits.at(-1).json[0].components.filter((c: any) => c.type === 10).map((c: any) => c.content));

beforeAll(async () => {
	replset = await MongoMemoryReplSet.create({
		replSet: { count: 1, storageEngine: "wiredTiger" },
		binary: { systemBinary: "/usr/bin/mongod" },
	});
	await mongoose.connect(replset.getUri(), { dbName: "agni_game_test" });
	await Promise.all(Object.values(DatabaseManager).filter((m: any) => m?.init).map((m: any) => m.init()));
	game = new GameManager(client);
});

afterAll(async () => {
	await game.shutdown();
	await mongoose.disconnect();
	await replset.stop();
});

describe("farm session", () => {
	const alice = fakeInteraction("alice", "Alice");
	const bob = fakeInteraction("bob", "Bob");

	test("play opens a viewport with a frame, 5 action buttons and two selects", async () => {
		await game.play(alice as any);
		const first = alice.edits.at(-1);
		expect(first.files).toHaveLength(1);
		const container = first.json[0];
		const rows = container.components.filter((c: any) => c.type === 1);
		expect(rows[0].components).toHaveLength(5);
		expect(rows[1].components[0].custom_id).toBe("farm:eq");
		expect(rows[2].components[0].custom_id).toBe("farm:menu");
		expect((await client.economy.wallet("alice")).coins).toBe(500);
	});

	test("starter kit is granted only once", async () => {
		await game.play(alice as any);
		expect((await client.economy.wallet("alice")).coins).toBe(500);
		expect((await client.economy.inventory("alice")).parsnip_seed).toBe(15);
	});

	test("farming loop through the real input path persists tiles and items", async () => {
		const world = (game as any).worlds.get("guild1");
		const p = world.players.get("alice");
		const plot = PLOTS[p.plotId]!;
		p.x = plot.x - 1;
		p.y = plot.y;
		p.facing = "r";
		await game.input(alice as any, { kind: "use" });
		expect(lastText(alice)).toContain("till");
		await game.input(alice as any, { kind: "equip", item: "parsnip_seed" });
		await game.input(alice as any, { kind: "use" });
		expect((await client.economy.inventory("alice")).parsnip_seed).toBe(14);
		const tile = await DatabaseManager.GameTile.findOne({ guildId: "guild1", x: plot.x, y: plot.y }).lean();
		expect(tile).toMatchObject({ tilled: true, cropId: "parsnip" });
	});

	test("input is rate limited to 4 actions per second", async () => {
		const before = alice.edits.length;
		await Promise.all(Array.from({ length: 8 }, () => game.input(alice as any, { kind: "move", dir: "u" })));
		// at most 4 accepted presses, batched into fewer frames
		expect(alice.edits.length - before).toBeLessThanOrEqual(4);
		expect(alice.edits.length - before).toBeGreaterThanOrEqual(1);
	});

	test("shop view buys seeds at the live price and renders valid selects", async () => {
		await new Promise((r) => setTimeout(r, 1100)); // let the previous test's rate-limit window pass
		await game.input(alice as any, { kind: "view", view: "shop" });
		expect(lastText(alice)).toContain("General Store");
		await game.input(alice as any, { kind: "buy", item: "wheat_seed", qty: 5 });
		expect((await client.economy.inventory("alice")).wheat_seed).toBe(5);
		expect(lastText(alice)).toContain("Bought 5×");
		await game.input(alice as any, { kind: "view", view: "game" });
	});

	test("a second player gets their own plot and is pushed to Alice's screen", async () => {
		const world = (game as any).worlds.get("guild1");
		const a = world.players.get("alice");
		const pushesBefore = alice.edits.length;
		await game.play(bob as any);
		const b = world.players.get("bob");
		expect(b.plotId).not.toBe(a.plotId);
		// Put Bob two tiles from Alice so his move lands inside her viewport
		b.x = a.x + 2;
		b.y = a.y;
		b.facing = "l";
		await game.input(bob as any, { kind: "move", dir: "l" });
		await new Promise((r) => setTimeout(r, 2200));
		expect(alice.edits.length).toBeGreaterThan(pushesBefore);
	});

	test("flush writes positions", async () => {
		await game.flush();
		const saved = await DatabaseManager.GamePlayer.findOne({ guildId: "guild1", userId: "bob" }).lean();
		expect(saved?.name).toBe("Bob");
	});

	const controls = (edit: any) =>
		edit.json[0].components.filter((c: any) => c.type === 1).flatMap((row: any) => row.components);

	test("idle viewport closes with every control disabled", async () => {
		const session = (game as any).sessions.get("guild1:alice");
		expect(session.idleTimer).toBeDefined();
		await (game as any).expire(session, "closed for test");
		const last = alice.edits.at(-1);
		expect(controls(last).every((c: any) => c.disabled === true)).toBe(true);
		expect(lastText(alice)).toContain("closed for test");
		expect((game as any).sessions.has("guild1:alice")).toBe(false);
	});

	test("a press on a closed viewport tells the player to run /farm play again", async () => {
		await game.input(alice as any, { kind: "move", dir: "l" });
		expect(controls(alice.edits.at(-1)).every((c: any) => c.disabled === true)).toBe(true);
		expect(lastText(alice)).toContain("/farm play");
		expect((game as any).sessions.has("guild1:alice")).toBe(false);
	});

	test("running /farm play again closes the old window and opens a live one", async () => {
		const first = fakeInteraction("carol", "Carol");
		const second = fakeInteraction("carol", "Carol");
		await game.play(first as any);
		await game.play(second as any);
		await new Promise((r) => setTimeout(r, 50));
		expect(controls(first.edits.at(-1)).every((c: any) => c.disabled === true)).toBe(true);
		expect(controls(second.edits.at(-1)).some((c: any) => c.disabled)).toBe(false);
	});
});
