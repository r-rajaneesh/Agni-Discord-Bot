// The open world: one deterministic public map that every lobby shares. Pure and shared with the browser client.
import { CHUNK } from "./chunks";
import { MAP_H, MAP_W, T, TOWN_MAP } from "./map";

export const WORLD_SEED = 0xa9e1;
export const WORLD_CHUNKS = 64; // chunk coords -32..31 on both axes → 1024 × 1024 tiles
export const TOWN_ORIGIN = { x: -24, y: -16 }; // top-left of the 48×32 town stamp; town centre at (0,0)

const HALF = (WORLD_CHUNKS * CHUNK) / 2; // world tiles span -HALF..HALF-1
const at = (i: number, j: number) => ({ x: TOWN_ORIGIN.x + i, y: TOWN_ORIGIN.y + j });

export const TOWN_SPAWN = at(23, 14);
export const LAND_GATE = at(23, 12);
export const SHOP_DOORS = [at(23, 5), at(24, 5)];
// Gaps cut in the town's tree border where the roads leave town (north, south, west, east)
export const TOWN_GATES = [at(23, 0), at(24, 0), at(23, 31), at(24, 31), at(0, 15), at(0, 16), at(47, 15), at(47, 16)];

export type TRegion = "town" | "meadow" | "forest" | "hills" | "lake" | "wilds" | "reserved";

interface TRect {
	x: number;
	y: number;
	w: number;
	h: number;
}
const inRect = (r: TRect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const overlaps = (a: TRect, b: TRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const grow = (r: TRect, n: number): TRect => ({ x: r.x - n, y: r.y - n, w: r.w + n * 2, h: r.h + n * 2 });

const TOWN_RECT: TRect = { x: TOWN_ORIGIN.x, y: TOWN_ORIGIN.y, w: MAP_W, h: MAP_H };
// Cleared outskirts around the town stamp
const TOWN_ZONE: TRect = { x: -64, y: -48, w: 128, h: 96 };
// Flat grass kept for later districts: City (east), Industrial (north), Port (south)
const RESERVED: TRect[] = [
	{ x: 200, y: -48, w: 96, h: 96 },
	{ x: -48, y: -420, w: 96, h: 96 },
	{ x: -48, y: 400, w: 96, h: 96 },
];

// Per-tile hash in [0, 1)
function hash(seed: number, x: number, y: number): number {
	let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(x, 0x85ebca6b) ^ Math.imul(y, 0xc2b2ae35);
	h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
	h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Smoothed value noise on a lattice of `cell` tiles
function valueNoise(seed: number, x: number, y: number, cell: number): number {
	const gx = Math.floor(x / cell);
	const gy = Math.floor(y / cell);
	const s = (t: number) => t * t * (3 - 2 * t);
	const fx = s(x / cell - gx);
	const fy = s(y / cell - gy);
	const a = hash(seed, gx, gy);
	const b = hash(seed, gx + 1, gy);
	const c = hash(seed, gx, gy + 1);
	const d = hash(seed, gx + 1, gy + 1);
	return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
const noise = (seed: number, x: number, y: number) =>
	0.7 * valueNoise(seed, x, y, 160) + 0.3 * valueNoise(seed + 7, x, y, 48);

export function regionAt(x: number, y: number): TRegion {
	x = Math.floor(x);
	y = Math.floor(y);
	if (inRect(TOWN_ZONE, x, y)) return "town";
	if (RESERVED.some((r) => inRect(r, x, y))) return "reserved";
	const height = noise(WORLD_SEED, x, y);
	if (height < 0.32) return "lake";
	if (height > 0.66) return "hills";
	const wet = noise(WORLD_SEED + 1, x, y);
	if (wet > 0.56) return "forest";
	if (wet < 0.46) return "meadow";
	return "wilds";
}

// Dirt roads, 2 tiles wide: a cross through town plus two square rings
const ROADS: TRect[] = [
	{ x: -HALF, y: -1, w: HALF * 2, h: 2 },
	{ x: -1, y: -HALF, w: 2, h: HALF * 2 },
];
for (const r of [160, 320])
	ROADS.push(
		{ x: -r, y: -r, w: r * 2 + 2, h: 2 },
		{ x: -r, y: r, w: r * 2 + 2, h: 2 },
		{ x: -r, y: -r, w: 2, h: r * 2 + 2 },
		{ x: r, y: -r, w: 2, h: r * 2 + 2 },
	);

// Public crop fields beside the roads in meadows, one grass tile from the road
const FIELD_CROPS = ["wheat", "potato", "parsnip", "pumpkin", "cotton", "berry"];
const FIELD_LONG = 9;
const FIELD_SHORT = 5;
interface TField extends TRect {
	crop: string;
}
const FIELDS: TField[] = [];
ROADS.forEach((road, n) => {
	const across = road.w > road.h ? "y" : "x";
	const len = Math.max(road.w, road.h);
	for (let t = 8, k = 0; t + FIELD_LONG < len - 8; t += 22, k++) {
		const before = k % 2 === 0;
		const f: TRect =
			across === "y"
				? { x: road.x + t, y: before ? road.y - 1 - FIELD_SHORT : road.y + road.h + 1, w: FIELD_LONG, h: FIELD_SHORT }
				: { x: before ? road.x - 1 - FIELD_SHORT : road.x + road.w + 1, y: road.y + t, w: FIELD_SHORT, h: FIELD_LONG };
		const corners = [
			[f.x, f.y],
			[f.x + f.w - 1, f.y],
			[f.x, f.y + f.h - 1],
			[f.x + f.w - 1, f.y + f.h - 1],
			[f.x + (f.w >> 1), f.y + (f.h >> 1)],
		];
		if (!corners.every(([cx, cy]) => regionAt(cx as number, cy as number) === "meadow")) continue;
		const margin = grow(f, 1);
		if (ROADS.some((r) => overlaps(r, margin)) || FIELDS.some((o) => overlaps(grow(o, 1), margin))) continue;
		if (hash(WORLD_SEED + 2, n, t) > 0.75) continue;
		const crop = FIELD_CROPS[Math.floor(hash(WORLD_SEED + 3, f.x, f.y) * FIELD_CROPS.length)] as string;
		FIELDS.push({ ...f, crop });
	}
});

function regionTile(region: TRegion, x: number, y: number): number {
	const r = hash(WORLD_SEED + 4, x, y);
	switch (region) {
		case "town":
			return r < 0.02 ? T.tree : r < 0.06 ? T.flowers : T.grass;
		case "meadow":
			return r < 0.03 ? T.tree : r < 0.045 ? T.rock : r < 0.12 ? T.flowers : T.grass;
		case "forest":
			return r < 0.5 ? T.tree : r < 0.53 ? T.rock : r < 0.57 ? T.flowers : T.grass;
		case "hills":
			return r < 0.3 ? T.rock : r < 0.36 ? T.tree : T.grass;
		case "lake":
			return T.water;
		case "wilds":
			return r < 0.18 ? T.tree : r < 0.28 ? T.rock : r < 0.33 ? T.flowers : T.grass;
		case "reserved":
			return T.grass;
	}
}

function townTile(x: number, y: number): number {
	if (x === LAND_GATE.x && y === LAND_GATE.y) return T.portal;
	if (TOWN_GATES.some((g) => g.x === x && g.y === y)) return T.path;
	return TOWN_MAP[(y - TOWN_ORIGIN.y) * MAP_W + (x - TOWN_ORIGIN.x)] as number;
}

// Terrain per 16×16 chunk. The world is bounded (64×64 chunks of 256 bytes, about 1 MB),
// so this cache is never evicted.
const cache = new Map<number, Uint8Array>();
const numKey = (cx: number, cy: number) => (cx + WORLD_CHUNKS) * 1024 + cy + WORLD_CHUNKS;

function chunkTiles(cx: number, cy: number): Uint8Array {
	const k = numKey(cx, cy);
	const hit = cache.get(k);
	if (hit) return hit;
	const box: TRect = { x: cx * CHUNK, y: cy * CHUNK, w: CHUNK, h: CHUNK };
	const roads = ROADS.filter((r) => overlaps(r, box));
	const fields = FIELDS.filter((f) => overlaps(grow(f, 1), box));
	const m = new Uint8Array(CHUNK * CHUNK);
	for (let j = 0; j < CHUNK; j++)
		for (let i = 0; i < CHUNK; i++) {
			const x = box.x + i;
			const y = box.y + j;
			let t: number;
			if (inRect(TOWN_RECT, x, y)) t = townTile(x, y);
			else if (fields.some((f) => inRect(f, x, y))) t = T.field;
			else if (fields.some((f) => inRect(grow(f, 1), x, y))) t = T.grass;
			else {
				const region = regionAt(x, y);
				if (roads.some((r) => inRect(r, x, y))) t = region === "lake" ? T.bridge : T.path;
				else t = regionTile(region, x, y);
			}
			m[j * CHUNK + i] = t;
		}
	cache.set(k, m);
	return m;
}

export function worldTerrain(x: number, y: number): number {
	x = Math.floor(x);
	y = Math.floor(y);
	if (x < -HALF || y < -HALF || x >= HALF || y >= HALF) return T.water; // ocean
	const cx = Math.floor(x / CHUNK);
	const cy = Math.floor(y / CHUNK);
	return chunkTiles(cx, cy)[(y - cy * CHUNK) * CHUNK + (x - cx * CHUNK)] as number;
}

export function fieldCrop(x: number, y: number): string | null {
	x = Math.floor(x);
	y = Math.floor(y);
	if (worldTerrain(x, y) !== T.field) return null;
	return FIELDS.find((f) => inRect(f, x, y))?.crop ?? null;
}
