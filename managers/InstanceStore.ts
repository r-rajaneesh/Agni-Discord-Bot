import { randomBytes } from "node:crypto";
import { canUnlock, chunkKey, START_CHUNKS, unlockPrice } from "../game/chunks";
import { createLand, type TDir, type TInstance, type TPlayerState, type TTileState } from "../game/engine";
import type EconomyManager from "./EconomyManager";
import { Land, LandTile, PlayerState } from "./models/Game";

export type TLocation = { instanceKind: "land" | "world"; landId?: string; lobby?: number; x: number; y: number; facing: TDir };
export type TStoredPlayer = TPlayerState & { location: TLocation };

export const landInstanceId = (landId: string) => `land:${landId}`;
export function landIdOf(inst: TInstance): string {
	if (inst.kind !== "land") throw new Error(`not a land instance: ${inst.id}`);
	return inst.id.slice("land:".length);
}

export default class InstanceStore {
	constructor(
		private eco: EconomyManager,
		private log: { error(...a: unknown[]): void },
	) {}

	async getOrCreateLand(ownerId: string, slot = 0): Promise<TInstance> {
		// Upsert is atomic with the unique {ownerId, slot} index, so concurrent callers share one land
		const landId = randomBytes(12).toString("hex");
		const seed = randomBytes(4).readUInt32BE() & 0x7fffffff;
		const land = await Land.findOneAndUpdate(
			{ ownerId, slot },
			{ $setOnInsert: { landId, ownerId, slot, seed, epoch: Date.now(), unlocked: START_CHUNKS, createdAt: new Date() } },
			{ upsert: true, new: true },
		).lean();
		const inst = createLand(landInstanceId(land.landId), ownerId, land.seed, land.epoch);
		inst.unlocked = new Set(land.unlocked);
		const tiles = await LandTile.find({ landId: land.landId }).lean();
		for (const t of tiles) {
			const s: TTileState = { wateredDays: t.wateredDays ?? [] };
			if (t.tilled != null) s.tilled = t.tilled;
			if (t.cropId != null) s.cropId = t.cropId;
			if (t.plantedDay != null) s.plantedDay = t.plantedDay;
			if (t.clearedDay != null) s.clearedDay = t.clearedDay;
			inst.tiles.set(`${t.x},${t.y}`, s);
		}
		return inst;
	}

	async loadPlayer(userId: string): Promise<TStoredPlayer | null> {
		const p = await PlayerState.findOne({ userId }).lean();
		if (!p || !p.location) return null;
		const loc = p.location;
		const location: TLocation = { instanceKind: loc.instanceKind, x: loc.x as number, y: loc.y as number, facing: loc.facing as TDir };
		if (loc.landId != null) location.landId = loc.landId;
		if (loc.lobby != null) location.lobby = loc.lobby;
		return {
			userId,
			name: p.name as string,
			colour: p.colour as string,
			energy: p.energy as number,
			lastEnergyAt: p.lastEnergyAt as number,
			equipped: p.equipped as string,
			x: location.x,
			y: location.y,
			facing: location.facing,
			location,
		};
	}

	async savePlayers(players: TStoredPlayer[]): Promise<void> {
		if (players.length === 0) return;
		await PlayerState.bulkWrite(
			players.map((p) => ({
				updateOne: {
					filter: { userId: p.userId },
					update: {
						$set: {
							name: p.name,
							colour: p.colour,
							energy: p.energy,
							lastEnergyAt: p.lastEnergyAt,
							equipped: p.equipped,
							location: { ...p.location, x: p.x, y: p.y, facing: p.facing },
						},
					},
					upsert: true,
				},
			})),
		);
	}

	/** False when the player has no saved state */
	async setEnergy(userId: string, energy: number, at: number): Promise<boolean> {
		return (await PlayerState.updateOne({ userId }, { $set: { energy, lastEnergyAt: at } })).matchedCount > 0;
	}

	/** True once the player has a saved position (has played) */
	async hasPlayer(userId: string): Promise<boolean> {
		return !!(await PlayerState.exists({ userId, location: { $exists: true } }));
	}

	/**
	 * Claims one of the player's `cap` mining gems for a UTC day. Returns its number (1..cap), or null when the cap is reached.
	 * Atomic: the counter only moves while it is below the cap, so concurrent claims never pass it.
	 */
	async claimOreGem(userId: string, day: string, cap: number): Promise<number | null> {
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const p = await PlayerState.findOneAndUpdate(
					{ userId, $or: [{ gemDay: { $ne: day } }, { gemsToday: { $lt: cap } }] },
					[{ $set: { gemsToday: { $cond: [{ $eq: ["$gemDay", day] }, { $add: ["$gemsToday", 1] }, 1] }, gemDay: day } }],
					{ upsert: true, new: true },
				).lean();
				return p?.gemsToday ?? null;
			} catch (e) {
				// The cap is reached (the upsert hit the existing row), or a first claim raced another; one retry tells which
				if ((e as { code?: number }).code !== 11000) throw e;
			}
		}
		return null;
	}

	async saveTiles(inst: TInstance, keys: string[]): Promise<void> {
		if (keys.length === 0) return;
		const landId = landIdOf(inst);
		await LandTile.bulkWrite(
			keys.map((key) => {
				const [x, y] = key.split(",").map(Number) as [number, number];
				const filter = { landId, x, y };
				const t = inst.tiles.get(key);
				if (!t) return { deleteOne: { filter } };
				const $set: Record<string, unknown> = { wateredDays: t.wateredDays };
				const $unset: Record<string, 1> = {};
				for (const f of ["tilled", "cropId", "plantedDay", "clearedDay"] as const) {
					if (t[f] === undefined) $unset[f] = 1;
					else $set[f] = t[f];
				}
				return { updateOne: { filter, update: { $set, ...(Object.keys($unset).length ? { $unset } : {}) }, upsert: true } };
			}),
		);
	}

	private unlockChains = new Map<string, Promise<unknown>>();

	// Unlocks on one land run one at a time, so the price is computed from the current size
	unlockChunk(
		inst: TInstance,
		userId: string,
		cx: number,
		cy: number,
	): Promise<{ ok: true; price: number } | { ok: false; msg: string }> {
		if (inst.kind !== "land" || inst.ownerId !== userId) return Promise.resolve({ ok: false, msg: "Only the owner can expand this land." });
		const landId = landIdOf(inst);
		const prev = this.unlockChains.get(landId) ?? Promise.resolve();
		const run = prev.then(() => this.doUnlock(inst, landId, userId, cx, cy));
		const tail = run.catch(() => {});
		this.unlockChains.set(landId, tail);
		void tail.then(() => {
			if (this.unlockChains.get(landId) === tail) this.unlockChains.delete(landId);
		});
		return run;
	}

	private async doUnlock(
		inst: TInstance,
		landId: string,
		userId: string,
		cx: number,
		cy: number,
	): Promise<{ ok: true; price: number } | { ok: false; msg: string }> {
		if (!Number.isInteger(cx) || !Number.isInteger(cy)) return { ok: false, msg: "Invalid chunk." };
		const key = chunkKey(cx, cy);
		if (inst.unlocked.has(key)) return { ok: false, msg: "Already unlocked." };
		if (!canUnlock(inst.unlocked, cx, cy)) return { ok: false, msg: "That chunk is not next to your land." };
		const price = unlockPrice(inst.unlocked.size);
		// The idempotency key means a retry never charges twice
		const r = await this.eco.transact([{ userId, coins: -price }], {
			reason: "chunk_unlock",
			ref: key,
			idempotencyKey: `unlock:${landId}:${key}`,
		});
		if (!r.ok) return { ok: false, msg: r.message };
		// Also runs on a duplicate: the charge happened, so finish persisting a purchase that failed earlier
		let pushed: number;
		try {
			pushed = (await Land.updateOne({ landId, unlocked: { $ne: key } }, { $push: { unlocked: key } })).modifiedCount;
		} catch (e) {
			this.log.error("unlock persist failed after charge", landId, key, e);
			return { ok: false, msg: "Couldn't save your new land. Try again \u2014 you won't be charged twice." };
		}
		inst.unlocked.add(key);
		if (r.duplicate && pushed === 0) return { ok: false, msg: "Already unlocked." };
		return { ok: true, price };
	}
}
