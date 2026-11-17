// Wild animals of one lobby. A world chunk is active while any player's AOI covers it: its animals spawn when it
// becomes active, are simulated only while active, and are dropped 60 s after it goes inactive (not persisted).
import { CHUNK, chunkKey } from "../../game/chunks";
import type { TInstance } from "../../game/engine";
import { spawnAnimals, tickAnimal, type TAnimal } from "../../game/entities";
import type { TServerMsg } from "../../game/protocol";
import { WORLD_CHUNKS } from "../../game/world";
import { AOI_CHUNKS, near, type TChunk } from "./aoi";

export const ANIMAL_DESPAWN_MS = 60_000;
const HALF = WORLD_CHUNKS / 2;

type TEnts = Extract<TServerMsg, { t: "ents" }>["ents"];
interface TWildChunk {
	animals: TAnimal[];
	/** When the chunk went inactive; null while active */
	inactiveAt: number | null;
}

// Positions on the wire, to the hundredth of a tile
const r2 = (n: number) => Math.round(n * 100) / 100;

export default class Wildlife {
	private chunks = new Map<string, TWildChunk>();

	constructor(
		private inst: TInstance,
		private rand: () => number = Math.random,
	) {}

	/** Every loaded animal, dead ones included */
	all(): TAnimal[] {
		return [...this.chunks.values()].flatMap((c) => c.animals);
	}

	find(id: number): TAnimal | undefined {
		for (const c of this.chunks.values()) for (const a of c.animals) if (a.id === id) return a;
		return undefined;
	}

	/** Spawns newly active chunks, simulates the active ones and drops chunks inactive for ANIMAL_DESPAWN_MS */
	tick(players: { x: number; y: number; chunk: TChunk }[], now: number, dtMs: number): void {
		const active = new Set<string>();
		// Players by chunk, to find the nearest one without checking them all
		const byChunk = new Map<string, { x: number; y: number }[]>();
		for (const p of players) {
			const k = chunkKey(p.chunk.cx, p.chunk.cy);
			let list = byChunk.get(k);
			if (!list) byChunk.set(k, (list = []));
			list.push(p);
			for (let cy = Math.max(-HALF, p.chunk.cy - AOI_CHUNKS); cy <= Math.min(HALF - 1, p.chunk.cy + AOI_CHUNKS); cy++)
				for (let cx = Math.max(-HALF, p.chunk.cx - AOI_CHUNKS); cx <= Math.min(HALF - 1, p.chunk.cx + AOI_CHUNKS); cx++)
					active.add(chunkKey(cx, cy));
		}
		for (const k of active) {
			const c = this.chunks.get(k);
			if (c) c.inactiveAt = null;
			else {
				const [cx, cy] = k.split(",").map(Number) as [number, number];
				this.chunks.set(k, { animals: spawnAnimals(cx, cy), inactiveAt: null });
			}
		}
		for (const [k, c] of this.chunks) {
			if (!active.has(k)) {
				c.inactiveAt ??= now;
				if (now - c.inactiveAt >= ANIMAL_DESPAWN_MS) this.chunks.delete(k);
				continue;
			}
			for (const a of c.animals) tickAnimal(a, this.inst, a.state === "dead" ? null : nearest(byChunk, a), now, dtMs, this.rand);
		}
	}

	/** Living animals whose position is within AOI of `chunk`, as sent in `ents` */
	visible(chunk: TChunk): TEnts {
		const out: TEnts = [];
		// Animals stay within a chunk of home, so one extra ring of home chunks covers every one in view
		const reach = AOI_CHUNKS + 1;
		for (let cy = chunk.cy - reach; cy <= chunk.cy + reach; cy++)
			for (let cx = chunk.cx - reach; cx <= chunk.cx + reach; cx++) {
				const c = this.chunks.get(chunkKey(cx, cy));
				if (!c) continue;
				for (const a of c.animals)
					if (a.state !== "dead" && near({ cx: Math.floor(a.x / CHUNK), cy: Math.floor(a.y / CHUNK) }, chunk))
						out.push([a.id, a.kind, r2(a.x), r2(a.y), a.facing]);
			}
		return out;
	}
}

// Nearest player within the animal's chunk or the eight around it (a flee radius is far less than a chunk)
function nearest(byChunk: Map<string, { x: number; y: number }[]>, a: TAnimal) {
	const cx = Math.floor(a.x / CHUNK);
	const cy = Math.floor(a.y / CHUNK);
	let best: { x: number; y: number; d: number } | null = null;
	for (let dy = -1; dy <= 1; dy++)
		for (let dx = -1; dx <= 1; dx++)
			for (const p of byChunk.get(chunkKey(cx + dx, cy + dy)) ?? []) {
				const d = Math.hypot(a.x - p.x, a.y - p.y);
				if (!best || d < best.d) best = { x: p.x, y: p.y, d };
			}
	return best;
}
