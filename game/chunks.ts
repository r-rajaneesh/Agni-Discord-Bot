// Private land: an unlimited grid of 16x16 chunks. Pure and shared with the browser client.
import { prng, T } from "./map";

export const CHUNK = 16;
export const START_CHUNKS: string[] = [];
for (let cy = -1; cy <= 1; cy++) for (let cx = -1; cx <= 1; cx++) START_CHUNKS.push(`${cx},${cy}`);

export const chunkKey = (cx: number, cy: number) => `${cx},${cy}`;

export function chunkOf(x: number, y: number): { cx: number; cy: number } {
	return { cx: Math.floor(x / CHUNK), cy: Math.floor(y / CHUNK) };
}

export const HOUSE = { x: 6, y: 5, w: 4, h: 3 }; // door at (8, 7)
export const LAND_SPAWN = { x: 8, y: 9 };
export const LAND_PORTAL = { x: 3, y: 9 };

const hash = (seed: number, cx: number, cy: number) =>
	(Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(cx, 0x85ebca6b) ^ Math.imul(cy, 0xc2b2ae35)) | 0;

// Terrain of one chunk, cached per land (seed) so a whole land can be dropped on unload
const cache = new Map<number, Map<number, Uint8Array>>();
const numKey = (cx: number, cy: number) => cx * 4194304 + cy;

export function dropLand(seed: number): void {
	cache.delete(seed);
}
export const cachedChunkCount = (seed: number) => cache.get(seed)?.size ?? 0;

// Scatter first, then forced areas
function chunkTiles(seed: number, cx: number, cy: number): Uint8Array {
	let land = cache.get(seed);
	if (!land) cache.set(seed, (land = new Map()));
	const k = numKey(cx, cy);
	const hit = land.get(k);
	if (hit) return hit;
	const rand = prng(hash(seed, cx, cy));
	const m = new Uint8Array(CHUNK * CHUNK).fill(T.grass);
	for (let i = 0; i < m.length; i++) {
		const r = rand();
		if (r < 0.07) m[i] = T.tree;
		else if (r < 0.11) m[i] = T.rock;
		else if (r < 0.17) m[i] = T.flowers;
	}
	if (rand() < 0.3) {
		const px = Math.floor(rand() * (CHUNK - 3));
		const py = Math.floor(rand() * (CHUNK - 3));
		for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) m[(py + j) * CHUNK + px + i] = T.water;
	}
	if (cx === 0 && cy === 0) {
		// Clear around spawn, house and portal, then place them
		const clear = (x0: number, y0: number, x1: number, y1: number) => {
			for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m[y * CHUNK + x] = T.grass;
		};
		clear(LAND_SPAWN.x - 3, LAND_SPAWN.y - 3, LAND_SPAWN.x + 3, LAND_SPAWN.y + 3);
		clear(HOUSE.x - 1, HOUSE.y - 1, HOUSE.x + HOUSE.w, HOUSE.y + HOUSE.h);
		clear(LAND_PORTAL.x - 1, LAND_PORTAL.y - 1, LAND_PORTAL.x + 1, LAND_PORTAL.y + 1);
		for (let y = HOUSE.y; y < HOUSE.y + HOUSE.h; y++)
			for (let x = HOUSE.x; x < HOUSE.x + HOUSE.w; x++) m[y * CHUNK + x] = T.house;
		m[LAND_PORTAL.y * CHUNK + LAND_PORTAL.x] = T.portal;
	}
	land.set(k, m);
	return m;
}

const mod = (n: number) => ((n % CHUNK) + CHUNK) % CHUNK;

export function landBaseTerrain(seed: number, x: number, y: number): number {
	x = Math.floor(x);
	y = Math.floor(y);
	const { cx, cy } = chunkOf(x, y);
	return chunkTiles(seed, cx, cy)[mod(y) * CHUNK + mod(x)] as number;
}

// Every tile of a locked chunk is a fence, so it blocks walking
export function landTerrain(seed: number, unlocked: ReadonlySet<string>, x: number, y: number): number {
	const { cx, cy } = chunkOf(x, y);
	if (!unlocked.has(chunkKey(cx, cy))) return T.fence;
	return landBaseTerrain(seed, x, y);
}

export function canUnlock(unlocked: ReadonlySet<string>, cx: number, cy: number): boolean {
	if (unlocked.has(chunkKey(cx, cy))) return false;
	return (
		unlocked.has(chunkKey(cx - 1, cy)) ||
		unlocked.has(chunkKey(cx + 1, cy)) ||
		unlocked.has(chunkKey(cx, cy - 1)) ||
		unlocked.has(chunkKey(cx, cy + 1))
	);
}

export const unlockPrice = (unlockedCount: number) => Math.round(500 * 1.35 ** (unlockedCount - 9));
