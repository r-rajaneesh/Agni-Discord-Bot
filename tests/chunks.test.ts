import { describe, expect, test } from "bun:test";
import {
	cachedChunkCount,
	canUnlock,
	CHUNK,
	dropLand,
	chunkOf,
	HOUSE,
	LAND_PORTAL,
	LAND_SPAWN,
	landBaseTerrain,
	landTerrain,
	START_CHUNKS,
	unlockPrice,
} from "../game/chunks";
import { isWalkableTerrain, T } from "../game/map";

describe("chunks", () => {
	test("chunkOf handles negatives", () => {
		expect(chunkOf(-1, -1)).toEqual({ cx: -1, cy: -1 });
		expect(chunkOf(15, 16)).toEqual({ cx: 0, cy: 1 });
	});
	test("terrain is deterministic and seed-dependent", () => {
		expect(landBaseTerrain(7, 5, -3)).toBe(landBaseTerrain(7, 5, -3));
		let diff = 0;
		for (let y = 0; y < 64; y++)
			for (let x = 0; x < 64; x++) if (landBaseTerrain(1, x, y) !== landBaseTerrain(2, x, y)) diff++;
		expect(diff).toBeGreaterThanOrEqual(64 * 64 * 0.1);
	});
	test("start area is clear", () => {
		for (let s = 1; s <= 20; s++) {
			const seed = s * 7919;
			for (let dy = -3; dy <= 3; dy++)
				for (let dx = -3; dx <= 3; dx++) {
					const x = LAND_SPAWN.x + dx;
					const y = LAND_SPAWN.y + dy;
					if (x >= HOUSE.x && x < HOUSE.x + HOUSE.w && y >= HOUSE.y && y < HOUSE.y + HOUSE.h) continue; // house wins
					const t = landBaseTerrain(seed, x, y);
					expect(isWalkableTerrain(t)).toBe(true);
					expect(t === T.grass || t === T.portal).toBe(true);
				}
			for (let y = HOUSE.y; y < HOUSE.y + HOUSE.h; y++)
				for (let x = HOUSE.x; x < HOUSE.x + HOUSE.w; x++) expect(landBaseTerrain(seed, x, y)).toBe(T.house);
			expect(landBaseTerrain(seed, LAND_PORTAL.x, LAND_PORTAL.y)).toBe(T.portal);
		}
	});
	test("locked chunks are not walkable", () => {
		expect(isWalkableTerrain(landTerrain(1, new Set(START_CHUNKS), 32, 9))).toBe(false);
		expect(START_CHUNKS.length).toBe(9);
	});
	test("canUnlock needs an edge neighbour", () => {
		const u = new Set(START_CHUNKS);
		expect(canUnlock(u, 2, 0)).toBe(true);
		expect(canUnlock(u, 2, 2)).toBe(false);
		expect(canUnlock(u, 0, 0)).toBe(false);
	});
	test("price curve", () => {
		expect(unlockPrice(9)).toBe(500);
		expect(unlockPrice(10)).toBe(675);
		expect(unlockPrice(19)).toBe(10053);
		expect(unlockPrice(29)).toBe(202137);
	});
	test("landTerrain returns base terrain inside unlocked chunks", () => {
		const u = new Set(START_CHUNKS);
		for (let y = -16; y < 32; y += 3)
			for (let x = -16; x < 32; x += 3) expect(landTerrain(5, u, x, y)).toBe(landBaseTerrain(5, x, y));
	});
	test("every tile of a locked chunk is T.fence", () => {
		const u = new Set(START_CHUNKS);
		for (let y = 0; y < CHUNK; y++)
			for (let x = 2 * CHUNK; x < 3 * CHUNK; x++) expect(landTerrain(1, u, x, y)).toBe(T.fence);
	});
	test("dropLand clears a seed's cached chunks", () => {
		const seed = 424242;
		const before = landBaseTerrain(seed, 3, 4);
		expect(cachedChunkCount(seed)).toBeGreaterThan(0);
		dropLand(seed);
		expect(cachedChunkCount(seed)).toBe(0);
		expect(landBaseTerrain(seed, 3, 4)).toBe(before);
	});
});
