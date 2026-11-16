import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import EconomyManager from "../managers/EconomyManager";
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
	await mongoose.connect(replset.getUri(), { dbName: "agni_test_store" });
	await Promise.all(models.map((m) => m.init()));
});

afterAll(async () => {
	await mongoose.disconnect();
	await replset.stop();
});

beforeEach(async () => {
	await Promise.all(models.map((m) => m.deleteMany({})));
});

const eco = new EconomyManager({ transactions: true, warn: () => {} });
const store = new InstanceStore(eco, { error: () => {} });
const coins = async (u: string) => (await eco.wallet(u)).coins;

describe("InstanceStore", () => {
	test("creates one land per owner, even concurrently", async () => {
		const lands = await Promise.all(Array.from({ length: 5 }, () => store.getOrCreateLand("u1")));
		expect(new Set(lands.map((l) => l.id)).size).toBe(1);
		expect(await Land.countDocuments({})).toBe(1);
		expect(lands[0]!.unlocked.size).toBe(9);
		expect(Number.isInteger(lands[0]!.seed) && lands[0]!.seed >= 0).toBe(true);
	});

	test("tiles round-trip", async () => {
		const inst = await store.getOrCreateLand("u1");
		inst.tiles.set("3,4", { tilled: true, cropId: "wheat", plantedDay: 2, wateredDays: [2, 3], clearedDay: 1 });
		inst.tiles.set("5,5", { tilled: true, wateredDays: [] });
		await store.saveTiles(inst, ["3,4", "5,5"]);
		const again = await store.getOrCreateLand("u1");
		expect(again.tiles).toEqual(inst.tiles);
		// Removing fields unsets them; removing a tile deletes it
		inst.tiles.set("3,4", { tilled: true, wateredDays: [] });
		inst.tiles.delete("5,5");
		await store.saveTiles(inst, ["3,4", "5,5"]);
		const third = await store.getOrCreateLand("u1");
		expect(third.tiles).toEqual(inst.tiles);
		expect(third.tiles.get("3,4")).toEqual({ tilled: true, wateredDays: [] });
	});

	test("players round-trip", async () => {
		expect(await store.loadPlayer("u1")).toBeNull();
		const p = {
			...{ userId: "u1", name: "A", colour: "red", energy: 50, lastEnergyAt: 123, equipped: "hoe", facing: "l" as const },
			x: 4.5,
			y: 7.25,
			location: { instanceKind: "world" as const, lobby: 2, x: 4.5, y: 7.25, facing: "l" as const },
		};
		await store.savePlayers([p]);
		await store.savePlayers([{ ...p, energy: 40 }]);
		expect(await store.loadPlayer("u1")).toEqual({ ...p, energy: 40 });
	});

	test("unlock charges and persists", async () => {
		await eco.transact([{ userId: "u1", coins: 1000 }], { reason: "seed" });
		const inst = await store.getOrCreateLand("u1");
		const r = await store.unlockChunk(inst, "u1", 2, 0);
		expect(r).toEqual({ ok: true, price: 500 });
		expect(await coins("u1")).toBe(500);
		expect((await Land.findOne({ landId: inst.id.slice(5) }))!.unlocked).toContain("2,0");
		expect(inst.unlocked.has("2,0")).toBe(true);
	});

	test("unlock rejects non-adjacent, already-unlocked, not-owner, and broke", async () => {
		await eco.transact([{ userId: "u1", coins: 1000 }], { reason: "seed" });
		await eco.transact([{ userId: "u2", coins: 10 }], { reason: "seed" });
		const inst = await store.getOrCreateLand("u1");
		expect(await store.unlockChunk(inst, "u1", 5, 5)).toEqual({ ok: false, msg: "That chunk is not next to your land." });
		expect(await store.unlockChunk(inst, "u1", 0, 0)).toEqual({ ok: false, msg: "Already unlocked." });
		expect(await store.unlockChunk(inst, "u2", 2, 0)).toEqual({ ok: false, msg: "Only the owner can expand this land." });
		const broke = await store.getOrCreateLand("u2");
		const b = await store.unlockChunk(broke, "u2", 2, 0);
		expect(b.ok).toBe(false);
		expect(b.ok === false && b.msg.length > 0).toBe(true);
		expect(await coins("u1")).toBe(1000);
		expect(await coins("u2")).toBe(10);
		expect(broke.unlocked.has("2,0")).toBe(false);
	});

	test("concurrent unlock charges once", async () => {
		await eco.transact([{ userId: "u1", coins: 5000 }], { reason: "seed" });
		const inst = await store.getOrCreateLand("u1");
		const rs = await Promise.all(Array.from({ length: 5 }, () => store.unlockChunk(inst, "u1", 2, 0)));
		expect(rs.filter((r) => r.ok)).toHaveLength(1);
		expect(await coins("u1")).toBe(4500);
		const doc = await Land.findOne({ landId: inst.id.slice(5) });
		expect(doc!.unlocked.filter((k) => k === "2,0")).toHaveLength(1);
		expect(inst.unlocked.has("2,0")).toBe(true);
	});

	test("concurrent unlocks of different chunks are priced in turn", async () => {
		await eco.transact([{ userId: "u1", coins: 5000 }], { reason: "seed" });
		const inst = await store.getOrCreateLand("u1");
		const rs = await Promise.all([store.unlockChunk(inst, "u1", 2, 0), store.unlockChunk(inst, "u1", -2, 0)]);
		expect(rs).toEqual([{ ok: true, price: 500 }, { ok: true, price: 675 }]);
		expect(await coins("u1")).toBe(5000 - 1175);
	});

	test("unlock persist failure heals on retry", async () => {
		await eco.transact([{ userId: "u1", coins: 1000 }], { reason: "seed" });
		const inst = await store.getOrCreateLand("u1");
		const orig = Land.updateOne.bind(Land);
		let n = 0;
		(Land as any).updateOne = (...a: any[]) => (n++ === 0 ? Promise.reject(new Error("boom")) : (orig as any)(...a));
		try {
			const first = await store.unlockChunk(inst, "u1", 2, 0);
			expect(first.ok).toBe(false);
			expect(inst.unlocked.has("2,0")).toBe(false);
			expect(await store.unlockChunk(inst, "u1", 2, 0)).toEqual({ ok: true, price: 500 });
		} finally {
			(Land as any).updateOne = orig;
		}
		const doc = await Land.findOne({ landId: inst.id.slice(5) });
		expect(doc!.unlocked.filter((k) => k === "2,0")).toHaveLength(1);
		expect(await coins("u1")).toBe(500);
	});
});
