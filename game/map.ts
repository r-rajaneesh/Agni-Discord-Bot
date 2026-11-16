// "Agni Valley": the shared map every guild world uses. Generated deterministically in code.

export const T = {
	grass: 0,
	path: 1,
	water: 2,
	tree: 3,
	rock: 4,
	farmland: 5,
	wall: 6,
	door: 7,
	bridge: 8,
	flowers: 9,
	roof: 10,
	portal: 11,
	fence: 12,
	house: 13,
	field: 14,
} as const;
export type TTerrain = (typeof T)[keyof typeof T];

export const MAP_W = 48;
export const MAP_H = 32;

interface TPlot {
	id: number;
	x: number;
	y: number;
	w: number;
	h: number;
}

const PLOT_W = 7;
const PLOT_H = 5;
const PLOTS: TPlot[] = [3, 13, 27, 34].flatMap((x, col) =>
	[18, 24].map((y, row) => ({ id: col * 2 + row, x, y, w: PLOT_W, h: PLOT_H })),
);

const WALKABLE = new Set<number>([T.grass, T.path, T.farmland, T.bridge, T.flowers, T.portal, T.field]);
export const isWalkableTerrain = (t: number) => WALKABLE.has(t);

// mulberry32: tiny seeded PRNG so every world gets the same map
export function prng(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// The town layout for the open world (game/world.ts). The old farm plots stay as grass so the
// random scatter around them keeps its old layout.
function build(): Uint8Array {
	const m = new Uint8Array(MAP_W * MAP_H).fill(T.grass);
	const set = (x: number, y: number, t: number) => {
		if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) m[y * MAP_W + x] = t;
	};
	const rect = (x: number, y: number, w: number, h: number, t: number) => {
		for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, t);
	};

	// River with a bridge on the main road
	rect(42, 0, 2, MAP_H, T.water);
	// Roads
	rect(1, 15, 41, 2, T.path);
	rect(23, 6, 2, MAP_H - 7, T.path);
	rect(42, 15, 2, 2, T.bridge);
	rect(44, 15, 3, 2, T.path);
	// Town square + shop
	rect(16, 2, 16, 8, T.path);
	rect(20, 2, 8, 2, T.roof);
	rect(20, 4, 8, 2, T.wall);
	set(23, 5, T.door);
	set(24, 5, T.door);
	// Farm plots
	PLOTS.forEach((p) => rect(p.x, p.y, p.w, p.h, T.grass));

	const rand = prng(0xa9e1);
	const isFree = (x: number, y: number) => m[y * MAP_W + x] === T.grass;
	const nearPlot = (x: number, y: number) =>
		PLOTS.some((p) => x >= p.x - 1 && x <= p.x + p.w && y >= p.y - 1 && y <= p.y + p.h);
	// Wild meadow: trees, rocks and flowers away from roads and plots
	for (let y = 1; y < MAP_H - 1; y++)
		for (let x = 1; x < 42; x++) {
			if (!isFree(x, y) || nearPlot(x, y)) continue;
			if (Math.abs(y - 15.5) < 2.5 || Math.abs(x - 23.5) < 2.5) continue;
			const r = rand();
			if (r < 0.07) set(x, y, T.tree);
			else if (r < 0.1) set(x, y, T.rock);
			else if (r < 0.16) set(x, y, T.flowers);
		}
	// Quarry beyond the river
	for (let y = 1; y < MAP_H - 1; y++)
		for (let x = 44; x < MAP_W - 1; x++) if (isFree(x, y) && rand() < 0.35) set(x, y, T.rock);
	// Tree border
	for (let x = 0; x < MAP_W; x++) {
		set(x, 0, T.tree);
		set(x, MAP_H - 1, T.tree);
	}
	for (let y = 0; y < MAP_H; y++) {
		set(0, y, T.tree);
		if (y < 15 || y > 16) set(MAP_W - 1, y, T.tree);
	}
	set(MAP_W - 1, 15, T.rock);
	set(MAP_W - 1, 16, T.rock);
	return m;
}

export const TOWN_MAP = build();
