// Retire the old guild-world collections after the Activity port.
// Safe by default: without --yes it only prints counts. With --backup-dir <dir> --yes it writes a JSON backup
// of each old collection, re-reads every file from disk and checks it parses and holds the same number of documents,
// and only then drops anything.
// Wallets, inventories, the ledger, purchases, subscriptions, ownerships and the new land collections are never touched.
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

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
		// Stream through a cursor so big collections never sit in memory; the file is one JSON array, one document per line
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
			// On disk before anything is dropped
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		log(`${name}: wrote ${written} documents to ${file}`);
	}
	// The drop is irreversible, so trust only what can be read back from disk
	for (const name of present) {
		const file = path.join(dir, `${name}.json`);
		const now = await db.collection(name).countDocuments();
		let onDisk: number;
		try {
			onDisk = await countBackup(file);
		} catch (e) {
			throw new Error(`Backup of ${name} is unreadable (${(e as Error).message}); nothing dropped`);
		}
		if (onDisk !== now) throw new Error(`Backup of ${name} does not match the collection (file has ${onDisk}, now ${now}); nothing dropped`);
		result.backedUp.push(name);
		log(`${name}: verified ${onDisk} documents in ${file}`);
	}
	for (const name of present) {
		await db.collection(name).drop();
		result.dropped.push(name);
		log(`${name}: dropped`);
	}
	return result;
}

/** Reads a backup line by line and parses every document; returns how many it holds, or throws */
async function countBackup(file: string): Promise<number> {
	const { EJSON } = mongoose.mongo.BSON;
	const lines = readline.createInterface({ input: fs.createReadStream(file, "utf8"), crlfDelay: Infinity });
	let n = 0;
	let line = 0;
	let state: "open" | "docs" | "closed" = "open";
	for await (const text of lines) {
		line++;
		if (state === "open") {
			if (text !== "[") throw new Error(`line ${line}: expected "["`);
			state = "docs";
		} else if (state === "docs") {
			if (text === "]") {
				state = "closed";
				continue;
			}
			try {
				EJSON.parse(text.endsWith(",") ? text.slice(0, -1) : text);
			} catch {
				throw new Error(`line ${line}: not a document`);
			}
			n++;
		} else if (text !== "") throw new Error(`line ${line}: text after "]"`);
	}
	if (state !== "closed") throw new Error("file ends before \"]\"");
	return n;
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
