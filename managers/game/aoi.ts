// Area of interest: a player sees what is within AOI_CHUNKS chunks of them (Chebyshev distance).
import { chunkOf } from "../../game/chunks";
import type { TTileState } from "../../game/engine";
import type { TTileView } from "../../game/protocol";

export const AOI_CHUNKS = 2;

export type TChunk = { cx: number; cy: number };
/** Changed tile keys by chunk key, so a chunk's changes can be sent when it comes into view */
export type TTileIndex = Map<string, Set<string>>;

export const near = (a: TChunk, b: TChunk) => Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy)) <= AOI_CHUNKS;

const chunkOfKey = (key: string) => {
	const [x, y] = key.split(",").map(Number) as [number, number];
	return chunkOf(x, y);
};

/** Adds the tile to the index when it has state, removes it when it has none */
export function indexTile(index: TTileIndex, tiles: Map<string, TTileState>, key: string) {
	const { cx, cy } = chunkOfKey(key);
	const ck = `${cx},${cy}`;
	let keys = index.get(ck);
	if (tiles.has(key)) {
		if (!keys) index.set(ck, (keys = new Set()));
		keys.add(key);
	} else if (keys) {
		keys.delete(key);
		if (keys.size === 0) index.delete(ck);
	}
}

/** Changed tiles in the chunks `want` accepts */
export function tilesIn(index: TTileIndex, tiles: Map<string, TTileState>, want: (c: TChunk) => boolean): [string, TTileView][] {
	const out: [string, TTileView][] = [];
	for (const [ck, keys] of index) {
		const [cx, cy] = ck.split(",").map(Number) as [number, number];
		if (!want({ cx, cy })) continue;
		for (const key of keys) out.push([key, { ...tiles.get(key)! }]);
	}
	return out;
}

/** The given tiles within AOI of `chunk`; null for a tile with no state left */
export function tilesNear(keys: string[], tiles: Map<string, TTileState>, chunk: TChunk): [string, TTileView | null][] {
	const out: [string, TTileView | null][] = [];
	for (const key of keys) {
		if (!near(chunkOfKey(key), chunk)) continue;
		const t = tiles.get(key);
		out.push([key, t ? { ...t } : null]);
	}
	return out;
}
