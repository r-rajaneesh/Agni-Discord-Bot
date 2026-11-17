import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
const { EJSON } = mongoose.mongo.BSON;
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate, OLD_COLLECTIONS } from "../scripts/migrate-activity";

let replset: MongoMemoryReplSet;
setDefaultTimeout(60_000);
const quiet = () => {};
const KEEP = ["wallets", "inventories", "ledger_entries", "purchases", "subscriptions", "ownerships", "lands", "land_tiles", "player_states"];
const db = () => mongoose.connection.db!;

beforeAll(async () => {
	replset = await MongoMemoryReplSet.create({
		replSet: { count: 1, storageEngine: "wiredTiger" },
		binary: process.env.MONGOMS_SYSTEM_BINARY ? undefined : { systemBinary: "/usr/bin/mongod" },
	});
	await mongoose.connect(replset.getUri(), { dbName: "agni_migrate_test" });
});
afterAll(async () => {
	await mongoose.disconnect();
	await replset.stop();
});
beforeEach(async () => {
	await db().dropDatabase();
});

async function seed(old = true) {
	if (old) for (const [i, name] of OLD_COLLECTIONS.entries()) await db().collection(name).insertMany(Array.from({ length: i + 2 }, (_, n) => ({ n, name })));
	for (const name of KEEP) await db().collection(name).insertMany([{ a: 1 }, { a: 2 }]);
}
const names = async () => (await db().listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "agni-backup-"));

describe("migrate-activity", () => {
	test("dry run changes nothing", async () => {
		await seed();
		const dir = tmp();
		const r = await migrate(db(), { backupDir: dir }, quiet);
		expect(r.dryRun).toBe(true);
		expect(r.counts).toEqual({ game_worlds: 2, game_players: 3, game_tiles: 4 });
		expect(fs.readdirSync(dir)).toEqual([]);
		expect(await names()).toEqual(expect.arrayContaining([...OLD_COLLECTIONS, ...KEEP]));
		const explicit = await migrate(db(), { backupDir: dir, yes: true, dryRun: true }, quiet);
		expect(explicit.dropped).toEqual([]);
		expect(await db().collection("game_tiles").countDocuments()).toBe(4);
	});

	test("refuses to drop without a backup dir", async () => {
		await seed();
		await expect(migrate(db(), { yes: true }, quiet)).rejects.toThrow("--backup-dir");
		expect(await db().collection("game_worlds").countDocuments()).toBe(2);
	});

	test("real run backs up, verifies counts, drops only the old three", async () => {
		await seed();
		const dir = tmp();
		const r = await migrate(db(), { backupDir: dir, yes: true }, quiet);
		expect(r.dropped.sort()).toEqual([...OLD_COLLECTIONS].sort());
		for (const [name, count] of Object.entries({ game_worlds: 2, game_players: 3, game_tiles: 4 })) {
			expect(JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8")).length).toBe(count);
		}
		const left = await names();
		for (const name of OLD_COLLECTIONS) expect(left).not.toContain(name);
		for (const name of KEEP) expect(await db().collection(name).countDocuments()).toBe(2);
	});

	test("missing old collections are a no-op", async () => {
		await seed(false);
		const dir = tmp();
		const r = await migrate(db(), { backupDir: dir, yes: true }, quiet);
		expect(r.dropped).toEqual([]);
		expect(fs.readdirSync(dir)).toEqual([]);
		for (const name of KEEP) expect(await db().collection(name).countDocuments()).toBe(2);
	});

	test("backup restores ObjectIds and Dates", async () => {
		const when = new Date("2026-01-02T03:04:05Z");
		await db().collection("game_worlds").insertOne({ at: when });
		const dir = tmp();
		await migrate(db(), { backupDir: dir, yes: true }, quiet);
		const [doc] = EJSON.parse(fs.readFileSync(path.join(dir, "game_worlds.json"), "utf8")) as any[];
		expect(doc._id).toBeInstanceOf(mongoose.Types.ObjectId);
		expect(doc.at).toBeInstanceOf(Date);
		expect(doc.at.getTime()).toBe(when.getTime());
	});

	test("refuses to overwrite an existing backup", async () => {
		await seed();
		const dir = tmp();
		fs.writeFileSync(path.join(dir, "game_tiles.json"), "[]");
		await expect(migrate(db(), { backupDir: dir, yes: true }, quiet)).rejects.toThrow("fresh --backup-dir");
		expect(await db().collection("game_worlds").countDocuments()).toBe(2);
		expect(fs.existsSync(path.join(dir, "game_worlds.json"))).toBe(false);
	});

	test("a count mismatch aborts before any drop", async () => {
		await seed();
		const dir = tmp();
		const real = db();
		// Report one extra document on every count after the first (the pre-backup count)
		const calls: Record<string, number> = {};
		const stub = new Proxy(real, {
			get(t, k) {
				if (k !== "collection") return (t as any)[k].bind(t);
				return (name: string) => {
					const c = t.collection(name);
					return new Proxy(c, {
						get(ct, ck) {
							if (ck === "countDocuments")
								return async () => ((calls[name] = (calls[name] ?? 0) + 1) > 1 ? (await ct.countDocuments()) + 1 : ct.countDocuments());
							const v = (ct as any)[ck];
							return typeof v === "function" ? v.bind(ct) : v;
						},
					});
				};
			},
		}) as typeof real;
		await expect(migrate(stub, { backupDir: dir, yes: true }, quiet)).rejects.toThrow("does not match");
		for (const name of OLD_COLLECTIONS) expect(await real.collection(name).countDocuments()).toBeGreaterThan(0);
	});

	test("a corrupted backup line aborts before any drop", async () => {
		await seed();
		const dir = tmp();
		const real = db();
		// Damages game_tiles.json on disk after it was written, when the check re-counts the collection
		const calls: Record<string, number> = {};
		const stub = new Proxy(real, {
			get(t, k) {
				if (k !== "collection") return (t as any)[k].bind(t);
				return (name: string) => {
					const c = t.collection(name);
					return new Proxy(c, {
						get(ct, ck) {
							if (ck === "countDocuments")
								return async () => {
									if ((calls[name] = (calls[name] ?? 0) + 1) > 1 && name === "game_tiles") {
										const file = path.join(dir, "game_tiles.json");
										const lines = fs.readFileSync(file, "utf8").split("\n");
										lines[2] = lines[2]!.slice(0, 10);
										fs.writeFileSync(file, lines.join("\n"));
									}
									return ct.countDocuments();
								};
							const v = (ct as any)[ck];
							return typeof v === "function" ? v.bind(ct) : v;
						},
					});
				};
			},
		}) as typeof real;
		await expect(migrate(stub, { backupDir: dir, yes: true }, quiet)).rejects.toThrow("game_tiles");
		for (const name of OLD_COLLECTIONS) expect(await real.collection(name).countDocuments()).toBeGreaterThan(0);
	});
});
