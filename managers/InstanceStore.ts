import { randomBytes } from "node:crypto";
import { canUnlock, chunkKey, START_CHUNKS, unlockPrice } from "../game/chunks";
import { createLand, type TDir, type TInstance, type TPlayerState, type TTileState } from "../game/engine";
import type EconomyManager from "./EconomyManager";
import { Land, LandTile, PlayerState } from "./models/Game";

export type TLocation = { instanceKind: "land" | "world"; landId?: string; lobby?: number; x: number; y: number; facing: TDir };
type TStoredPlayer = TPlayerState & { location: TLocation };

const landInstanceId = (landId: string) => `land:${landId}`;

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
		const fresh = land;
		const inst = createLand(landInstanceId(fresh.landId), ownerId, fresh.seed, fresh.epoch);
		inst.unlocked = new Set(fresh.unlocked);
		const tiles = await LandTile.find({ landId: fresh.landId }).lean();
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
							location: p.location,
						},
					},
					upsert: true,
				},
			})),
		);
	}

	async saveTiles(inst: TInstance, keys: string[]): Promise<void> {
		if (keys.length === 0) return;
		const landId = inst.id.slice("land:".length);
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

	async unlockChunk(
		inst: TInstance,
		userId: string,
		cx: number,
		cy: number,
	): Promise<{ ok: true; price: number } | { ok: false; msg: string }> {
		if (inst.kind !== "land" || inst.ownerId !== userId) return { ok: false, msg: "Only the owner can expand this land." };
		if (!Number.isInteger(cx) || !Number.isInteger(cy)) return { ok: false, msg: "Invalid chunk." };
		const key = chunkKey(cx, cy);
		if (inst.unlocked.has(key)) return { ok: false, msg: "Already unlocked." };
		if (!canUnlock(inst.unlocked, cx, cy)) return { ok: false, msg: "That chunk is not next to your land." };
		const price = unlockPrice(inst.unlocked.size);
		const landId = inst.id.slice("land:".length);
		// The idempotency key makes concurrent unlocks of one chunk charge once
		const r = await this.eco.transact([{ userId, coins: -price }], {
			reason: "chunk_unlock",
			ref: key,
			idempotencyKey: `unlock:${landId}:${key}`,
		});
		if (!r.ok) return { ok: false, msg: r.message };
		if (r.duplicate) return { ok: false, msg: "Already unlocked." };
		try {
			await Land.updateOne({ landId, unlocked: { $ne: key } }, { $push: { unlocked: key } });
		} catch (e) {
			this.log.error("unlock persist failed after charge", landId, key, e);
		}
		inst.unlocked.add(key);
		return { ok: true, price };
	}
}
