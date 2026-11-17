// Retire the old guild-world collections after the Activity port.
// Safe by default: without --yes it only prints counts. With --backup-dir <dir> --yes it writes a JSON backup
// of each old collection, checks the file holds the same number of documents, and only then drops it.
// Wallets, inventories, the ledger, purchases, subscriptions, ownerships and the new land collections are never touched.
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";

// Mongoose pluralised the old model names game_world, game_player and game_tile
export const OLD_COLLECTIONS = ["game_worlds", "game_players", "game_tiles"] as const;

export type TMigrateOptions = { backupDir?: string; yes?: boolean; dryRun?: boolean };
export type TMigrateResult = { dryRun: boolean; counts: Record<string, number>; backedUp: string[]; dropped: string[] };

export async function migrate(db: mongoose.mongo.Db, opts: TMigrateOptions, log: (msg: string) => void = console.log): Promise<TMigrateResult> {
	const dryRun = opts.dryRun || !opts.yes;
	if (!dryRun && !opts.backupDir) throw new Error("--yes needs --backup-dir <dir>; refusing to drop without a backup");
	const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
	const result: TMigrateResult = { dryRun, counts: {}, backedUp: [], dropped: [] };
	const present = OLD_COLLECTIONS.filter((name) => existing.has(name));
	for (const name of OLD_COLLECTIONS) {
		if (!existing.has(name)) {
			log(`${name}: not found, skipping`);
			continue;
		}
		result.counts[name] = await db.collection(name).countDocuments();
		log(`${name}: ${result.counts[name]} documents`);
	}
	if (dryRun) {
		for (const name of present) log(`would back up ${name} and then drop it`);
		log("Dry run: nothing changed. Pass --backup-dir <dir> --yes to back up and drop.");
		return result;
	}
	if (!present.length) {
		log("Nothing to migrate.");
		return result;
	}
	// Write and verify every backup before dropping anything
	const dir = path.resolve(opts.backupDir!);
	fs.mkdirSync(dir, { recursive: true });
	const { EJSON } = mongoose.mongo.BSON;
	for (const name of present) {
		if (fs.existsSync(path.join(dir, `${name}.json`))) throw new Error(`${path.join(dir, `${name}.json`)} already exists; use a fresh --backup-dir`);
	}
	for (const name of present) {
		// Stream through a cursor so big collections never sit in memory; the file is one JSON array
		const file = path.join(dir, `${name}.json`);
		const fd = fs.openSync(file, "wx");
		let written = 0;
		try {
			fs.writeSync(fd, "[");
			for await (const doc of db.collection(name).find({})) {
				fs.writeSync(fd, `${written ? ",\n" : "\n"}${EJSON.stringify(doc, { relaxed: false })}`);
				written++;
			}
			fs.writeSync(fd, "\n]\n");
		} finally {
			fs.closeSync(fd);
		}
		const now = await db.collection(name).countDocuments();
		const onDisk = written;
		if (onDisk !== now) throw new Error(`Backup of ${name} does not match the collection (wrote ${written}, now ${now}); nothing dropped`);
		result.backedUp.push(name);
		log(`${name}: backed up ${onDisk} documents to ${file}`);
	}
	for (const name of present) {
		await db.collection(name).drop();
		result.dropped.push(name);
		log(`${name}: dropped`);
	}
	return result;
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const flag = (name: string) => args.includes(name);
	const i = args.indexOf("--backup-dir");
	const backupDir = i >= 0 ? args[i + 1] : undefined;
	if (i >= 0 && (!backupDir || backupDir.startsWith("--"))) {
		console.error("--backup-dir needs a directory");
		process.exit(1);
	}
	if (!process.env.DB_URL) {
		console.error("DB_URL is not set");
		process.exit(1);
	}
	await mongoose.connect(process.env.DB_URL);
	try {
		await migrate(mongoose.connection.db!, { backupDir, yes: flag("--yes"), dryRun: flag("--dry-run") });
	} catch (e) {
		console.error((e as Error).message);
		process.exitCode = 1;
	} finally {
		await mongoose.disconnect();
	}
}
