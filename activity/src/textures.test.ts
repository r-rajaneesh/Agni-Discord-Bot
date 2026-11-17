import { expect, test } from "bun:test";
import { HOUSE, LAND_PORTAL } from "@game/chunks";
import { DAY_MS, HOUSE_DOOR, createLand, createLobby, tileKey } from "@game/engine";
import { T } from "@game/map";
import { LAND_GATE, worldTerrain } from "@game/world";
import { WATER_FRAME_MS } from "./assets/manifest";
import { isWaterFrame, tileLayers } from "./textures";

const land = () => createLand("land:me", "me", 42, 0);

// First world tile of the given terrain, scanning out from the town
function findWorld(t: number): { x: number; y: number } {
	for (let r = 0; r < 512; r += 1)
		for (let x = -r; x <= r; x++)
			for (const y of [-r, r]) if (worldTerrain(x, y) === t) return { x, y };
	throw new Error(`no terrain ${t}`);
}

test("grass picks one of four variants, also at negative coordinates", () => {
	const inst = land();
	const seen = new Set<string>();
	for (let x = -6; x < 6; x++) {
		const k = tileLayers(inst, x, LAND_PORTAL.y + 1, 0)[0]!;
		if (k.startsWith("grass_")) seen.add(k);
	}
	expect([...seen].every((k) => /^grass_[0-3]$/.test(k))).toBe(true);
	expect(seen.size).toBeGreaterThan(1);
});

test("portal, and the house's roof, walls, footing and door with trimmed ends", () => {
	const inst = land();
	expect(tileLayers(inst, LAND_PORTAL.x, LAND_PORTAL.y, 0)).toEqual(expect.arrayContaining(["portal"]));
	expect(tileLayers(inst, HOUSE.x, HOUSE.y, 0)).toEqual(["house_roof_l"]);
	expect(tileLayers(inst, HOUSE.x + 1, HOUSE.y, 0)).toEqual(["house_roof_m"]);
	expect(tileLayers(inst, HOUSE.x + HOUSE.w - 1, HOUSE.y + 1, 0)).toEqual(["house_wall_r"]);
	expect(tileLayers(inst, HOUSE_DOOR.x, HOUSE_DOOR.y, 0)).toEqual(["house_door"]);
	expect(tileLayers(inst, HOUSE.x, HOUSE_DOOR.y, 0)).toEqual(["house_base_l"]);
	expect(tileLayers(createLobby(1, "L", null, 0), LAND_GATE.x, LAND_GATE.y, 0)).toEqual(expect.arrayContaining(["portal"]));
});

test("locked chunk tiles draw their real terrain, dimmed, with a fence on the edge facing open land", () => {
	const inst = land();
	// (0,-2) is locked; its bottom row borders unlocked chunk (0,-1)
	const edge = tileLayers(inst, 4, -17, 0);
	expect(edge.at(-2)).toBe("dim");
	expect(edge.at(-1)).toBe("fence_h");
	const inner = tileLayers(inst, 4, -20, 0);
	expect(inner.at(-1)).toBe("dim");
	expect(inner.some((l) => l.startsWith("fence"))).toBe(false);
	// (2,0) is locked; its west column borders unlocked chunk (1,0), so that fence runs down the tile
	expect(tileLayers(inst, 2 * 16, 4, 0).at(-1)).toBe("fence_v");
	// With (2,0) open too, locked (2,1)'s top-left tile borders open land west and north: both fences
	inst.unlocked.add("2,0");
	expect(tileLayers(inst, 32, 16, 0).filter((l) => l.startsWith("fence"))).toEqual(["fence_v", "fence_h"]);
});

test("tilled, watered and growing crops on land", () => {
	const inst = land();
	const x = LAND_PORTAL.x + 1;
	const y = LAND_PORTAL.y + 1;
	inst.tiles.set(tileKey(x, y), { tilled: true, wateredDays: [] });
	expect(tileLayers(inst, x, y, 0).slice(1)).toEqual(["tilled"]);
	inst.tiles.set(tileKey(x, y), { tilled: true, cropId: "wheat", plantedDay: 1, wateredDays: [1] });
	expect(tileLayers(inst, x, y, 0).slice(1)).toEqual(["watered", "crop_wheat_0"]);
	expect(tileLayers(inst, x, y, DAY_MS).slice(1)).toEqual(["tilled", "crop_wheat_1"]);
	inst.tiles.set(tileKey(x, y), { tilled: true, cropId: "wheat", plantedDay: 1, wateredDays: [1, 2] });
	expect(tileLayers(inst, x, y, 2 * DAY_MS).slice(1)).toEqual(["tilled", "crop_wheat_2"]);
});

test("a public field shows its crop, and tilled soil while it regrows", () => {
	const inst = createLobby(1, "L", null, 0);
	const f = findWorld(T.field);
	const ripe = tileLayers(inst, f.x, f.y, 0);
	expect(ripe).toHaveLength(1);
	expect(ripe[0]).toMatch(/^field_/);
	inst.tiles.set(tileKey(f.x, f.y), { tilled: true, wateredDays: [], regrowAt: 5000 });
	expect(tileLayers(inst, f.x, f.y, 4999)).toEqual(["tilled"]);
	expect(tileLayers(inst, f.x, f.y, 5000)).toEqual(ripe);
});

test("a cut tree is grass until it regrows", () => {
	const inst = createLobby(1, "L", null, 0);
	const t = findWorld(T.tree);
	expect(tileLayers(inst, t.x, t.y, 0).at(-1)).toMatch(/^tree_/);
	inst.tiles.set(tileKey(t.x, t.y), { wateredDays: [], regrowAt: 5000 });
	expect(tileLayers(inst, t.x, t.y, 0)).toHaveLength(1);
	expect(tileLayers(inst, t.x, t.y, 0)[0]).toMatch(/^grass_/);
});

test("water shimmers: a tile steps through its frames over time", () => {
	const inst = createLobby(1, "L", null, 0);
	const w = findWorld(T.water);
	const seen = new Set<string>();
	for (let i = 0; i < 3; i++) seen.add(tileLayers(inst, w.x, w.y, i * WATER_FRAME_MS)[0]!);
	expect([...seen].every((k) => /^water_\d$/.test(k))).toBe(true);
	expect(seen.size).toBe(3);
	expect(isWaterFrame(tileLayers(inst, w.x, w.y, 0)[0]!)).toBe(true);
	expect(isWaterFrame("shore_5")).toBe(false);
});

test("water gets a bank on each side that borders land, and none toward a bridge", () => {
	const inst = createLobby(1, "L", null, 0);
	// The river's west bank: land to the west, water to the east
	const w = findWorld(T.water);
	while (worldTerrain(w.x - 1, w.y) === T.water) w.x--;
	const at = (x: number, y: number) => tileLayers(inst, x, y, 0);
	const mask = (x: number, y: number) => (worldTerrain(x, y - 1) === T.water || worldTerrain(x, y - 1) === T.bridge ? 0 : 1) | (worldTerrain(x + 1, y) === T.water || worldTerrain(x + 1, y) === T.bridge ? 0 : 2) | (worldTerrain(x, y + 1) === T.water || worldTerrain(x, y + 1) === T.bridge ? 0 : 4) | 8;
	expect(at(w.x, w.y)[1]).toBe(`shore_${mask(w.x, w.y)}`);
	// Next to the bridge the river runs on: no bank on that side
	const b = findWorld(T.bridge);
	let x = b.x;
	while (worldTerrain(x, b.y) === T.bridge) x--;
	const bank = at(x, b.y)[1];
	expect(bank === undefined || (Number(bank.slice(6)) & 2) === 0).toBe(true);
});

test("the shop front: a sign over the doors, posts only at the ends, windows on alternate tiles", () => {
	const inst = createLobby(1, "L", null, 0);
	const d = findWorld(T.door);
	while (worldTerrain(d.x - 1, d.y) === T.door) d.x--;
	expect(tileLayers(inst, d.x, d.y, 0)).toEqual(["door"]);
	expect(tileLayers(inst, d.x, d.y - 1, 0)).toEqual(["shop_sign_l"]);
	expect(tileLayers(inst, d.x + 1, d.y - 1, 0)).toEqual(["shop_sign_r"]);
	let l = d.x;
	while (worldTerrain(l - 1, d.y) === T.wall) l--;
	expect(tileLayers(inst, l, d.y, 0)).toEqual(["shop_lower_l"]);
	expect(tileLayers(inst, l, d.y - 1, 0)).toEqual(["shop_upper_l"]);
	const mids = [1, 2].map((i) => tileLayers(inst, l + i, d.y, 0)[0]);
	expect(mids.sort()).toEqual(["shop_lower_m", "shop_lower_win"]);
});

test("the shop roof has a ridge on its top row", () => {
	const inst = createLobby(1, "L", null, 0);
	const r = findWorld(T.roof);
	while (worldTerrain(r.x, r.y - 1) === T.roof) r.y--;
	expect(tileLayers(inst, r.x, r.y, 0)).toEqual(["roof_ridge"]);
	expect(tileLayers(inst, r.x, r.y + 1, 0)).toEqual(["roof"]);
});
