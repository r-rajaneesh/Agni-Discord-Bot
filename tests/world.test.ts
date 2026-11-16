import { describe, expect, test } from "bun:test";
import { CROPS } from "../game/data/crops";
import { isWalkableTerrain, MAP_H, MAP_W, T, TOWN_MAP } from "../game/map";
import {
	fieldCrop,
	LAND_GATE,
	regionAt,
	SHOP_DOORS,
	TOWN_GATES,
	TOWN_ORIGIN,
	TOWN_SPAWN,
	type TRegion,
	WORLD_CHUNKS,
	worldTerrain,
} from "../game/world";

const HALF = (WORLD_CHUNKS * 16) / 2;
const key = (x: number, y: number) => `${x},${y}`;

// BFS over walkable tiles from TOWN_SPAWN, capped at a Chebyshev radius
function reachable(radius: number): Set<number> {
	const side = radius * 2 + 1;
	const seen = new Uint8Array(side * side);
	const idx = (x: number, y: number) => (y - TOWN_SPAWN.y + radius) * side + (x - TOWN_SPAWN.x + radius);
	const out = new Set<number>();
	const qx: number[] = [TOWN_SPAWN.x];
	const qy: number[] = [TOWN_SPAWN.y];
	seen[idx(TOWN_SPAWN.x, TOWN_SPAWN.y)] = 1;
	for (let h = 0; h < qx.length; h++) {
		const x = qx[h] as number;
		const y = qy[h] as number;
		out.add(x * 4096 + y);
		for (const [dx, dy] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		] as const) {
			const nx = x + dx;
			const ny = y + dy;
			if (Math.abs(nx - TOWN_SPAWN.x) > radius || Math.abs(ny - TOWN_SPAWN.y) > radius) continue;
			const i = idx(nx, ny);
			if (seen[i]) continue;
			seen[i] = 1;
			if (!isWalkableTerrain(worldTerrain(nx, ny))) continue;
			qx.push(nx);
			qy.push(ny);
		}
	}
	return out;
}
const has = (set: Set<number>, x: number, y: number) => set.has(x * 4096 + y);

let bfs: Set<number> | undefined;
const reach = () => (bfs ??= reachable(400));

describe("world", () => {
	test("town stamp matches the old layout", () => {
		const skip = new Set([key(LAND_GATE.x, LAND_GATE.y), ...TOWN_GATES.map((g) => key(g.x, g.y))]);
		for (let j = 0; j < MAP_H; j++)
			for (let i = 0; i < MAP_W; i++) {
				const x = TOWN_ORIGIN.x + i;
				const y = TOWN_ORIGIN.y + j;
				if (skip.has(key(x, y))) continue;
				expect(worldTerrain(x, y)).toBe(TOWN_MAP[j * MAP_W + i] as number);
			}
		expect(worldTerrain(LAND_GATE.x, LAND_GATE.y)).toBe(T.portal);
		for (const g of TOWN_GATES) expect(worldTerrain(g.x, g.y)).toBe(T.path);
		for (const d of SHOP_DOORS) expect(worldTerrain(d.x, d.y)).toBe(T.door);
		expect(TOWN_SPAWN).toEqual({ x: TOWN_ORIGIN.x + 23, y: TOWN_ORIGIN.y + 14 });
	});

	test("deterministic", () => {
		const a: number[] = [];
		const b: number[] = [];
		for (let y = -128; y < 128; y++) for (let x = -128; x < 128; x++) a.push(worldTerrain(x, y));
		for (let y = -128; y < 128; y++) for (let x = -128; x < 128; x++) b.push(worldTerrain(x, y));
		expect(a).toEqual(b);
		expect(regionAt(300, -200)).toBe(regionAt(300, -200));
	});

	test("ocean border", () => {
		expect(worldTerrain(-513, 0)).toBe(T.water);
		expect(worldTerrain(0, 512)).toBe(T.water);
		expect(worldTerrain(-HALF - 40, -HALF - 40)).toBe(T.water);
	});

	test("regions exist", () => {
		const found = new Set<TRegion>();
		for (let y = -HALF; y < HALF; y += 16) for (let x = -HALF; x < HALF; x += 16) found.add(regionAt(x, y));
		const all: TRegion[] = ["town", "meadow", "forest", "hills", "lake", "wilds", "reserved"];
		for (const r of all) expect(found.has(r)).toBe(true);
	});

	test("reachable", () => {
		const r = reach();
		expect(has(r, LAND_GATE.x, LAND_GATE.y)).toBe(true);
		for (const d of SHOP_DOORS) {
			// Doors are not walkable; one of their neighbours must be reached
			const near = [
				[0, 1],
				[0, -1],
				[1, 0],
				[-1, 0],
			].some(([dx, dy]) => has(r, d.x + (dx as number), d.y + (dy as number)));
			expect(near).toBe(true);
		}
		const regions = new Set<TRegion>();
		for (const k of r) {
			const x = Math.round(k / 4096);
			const y = k - x * 4096;
			regions.add(regionAt(x, y));
		}
		for (const want of ["meadow", "forest", "hills", "wilds"] as TRegion[]) expect(regions.has(want)).toBe(true);
	});

	test("no farmland in the world", () => {
		for (let y = -HALF; y < HALF; y += 3) for (let x = -HALF; x < HALF; x += 3) expect(worldTerrain(x, y)).not.toBe(T.farmland);
		for (let y = -40; y < 40; y++) for (let x = -40; x < 40; x++) expect(worldTerrain(x, y)).not.toBe(T.farmland);
	});

	test("meadows have public fields", () => {
		const r = reach();
		const seen = new Set<string>();
		const rects: { x: number; y: number; w: number; h: number; crop: string }[] = [];
		for (let y = TOWN_SPAWN.y - 300; y <= TOWN_SPAWN.y + 300; y++)
			for (let x = TOWN_SPAWN.x - 300; x <= TOWN_SPAWN.x + 300; x++) {
				if (worldTerrain(x, y) !== T.field || seen.has(key(x, y))) continue;
				// Top-left corner of a new field: grow right and down
				let w = 0;
				while (worldTerrain(x + w, y) === T.field) w++;
				let h = 0;
				while (worldTerrain(x, y + h) === T.field) h++;
				const crop = fieldCrop(x, y);
				expect(crop).not.toBeNull();
				for (let j = 0; j < h; j++)
					for (let i = 0; i < w; i++) {
						expect(worldTerrain(x + i, y + j)).toBe(T.field);
						expect(fieldCrop(x + i, y + j)).toBe(crop);
						seen.add(key(x + i, y + j));
					}
				// Rectangle: nothing field-coloured around it
				for (let i = -1; i <= w; i++) {
					expect(worldTerrain(x + i, y - 1)).not.toBe(T.field);
					expect(worldTerrain(x + i, y + h)).not.toBe(T.field);
				}
				for (let j = 0; j < h; j++) {
					expect(worldTerrain(x - 1, y + j)).not.toBe(T.field);
					expect(worldTerrain(x + w, y + j)).not.toBe(T.field);
				}
				expect(regionAt(x, y)).toBe("meadow");
				expect(has(r, x, y)).toBe(true);
				rects.push({ x, y, w, h, crop: crop as string });
			}
		expect(rects.length).toBeGreaterThanOrEqual(6);
		for (const f of rects) expect(CROPS[f.crop]).toBeDefined();
		expect(new Set(rects.map((f) => f.crop)).size).toBeGreaterThan(1);
		expect(fieldCrop(TOWN_SPAWN.x, TOWN_SPAWN.y)).toBeNull();
	});
});
