import { expect, test } from "bun:test";
import { HOUSE, LAND_PORTAL } from "@game/chunks";
import { DAY_MS, HOUSE_DOOR, createLand, createLobby, tileKey } from "@game/engine";
import { T } from "@game/map";
import { LAND_GATE, worldTerrain } from "@game/world";
import { tileLayers } from "./textures";

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
		if (k.startsWith("grass")) seen.add(k);
	}
	expect([...seen].every((k) => /^grass[0-3]$/.test(k))).toBe(true);
	expect(seen.size).toBeGreaterThan(1);
});

test("portal, house roof and house door", () => {
	const inst = land();
	expect(tileLayers(inst, LAND_PORTAL.x, LAND_PORTAL.y, 0)).toEqual(expect.arrayContaining(["portal"]));
	expect(tileLayers(inst, HOUSE.x, HOUSE.y, 0)).toEqual(["house_roof"]);
	expect(tileLayers(inst, HOUSE_DOOR.x, HOUSE_DOOR.y, 0)).toEqual(["house_door"]);
	expect(tileLayers(inst, HOUSE.x, HOUSE_DOOR.y, 0)).toEqual(["house_wall"]);
	expect(tileLayers(createLobby(1, "L", null, 0), LAND_GATE.x, LAND_GATE.y, 0)).toEqual(expect.arrayContaining(["portal"]));
});

test("locked chunk tiles draw their real terrain, dimmed, with a fence on the edge facing open land", () => {
	const inst = land();
	// (0,-2) is locked; its bottom row borders unlocked chunk (0,-1)
	const edge = tileLayers(inst, 4, -17, 0);
	expect(edge.at(-2)).toBe("dim");
	expect(edge.at(-1)).toBe("fence");
	const inner = tileLayers(inst, 4, -20, 0);
	expect(inner.at(-1)).toBe("dim");
	expect(inner).not.toContain("fence");
});

test("tilled, watered and growing crops on land", () => {
	const inst = land();
	const x = LAND_PORTAL.x + 1;
	const y = LAND_PORTAL.y + 1;
	inst.tiles.set(tileKey(x, y), { tilled: true, wateredDays: [] });
	expect(tileLayers(inst, x, y, 0).slice(1)).toEqual(["tilled"]);
	inst.tiles.set(tileKey(x, y), { tilled: true, cropId: "wheat", plantedDay: 1, wateredDays: [1] });
	expect(tileLayers(inst, x, y, 0).slice(1)).toEqual(["watered", "seedling"]);
	expect(tileLayers(inst, x, y, DAY_MS).slice(1)).toEqual(["tilled", "sprout"]);
	inst.tiles.set(tileKey(x, y), { tilled: true, cropId: "wheat", plantedDay: 1, wateredDays: [1, 2] });
	expect(tileLayers(inst, x, y, 2 * DAY_MS).slice(1)).toEqual(["tilled", "ripe:wheat"]);
});

test("a public field shows its crop, and tilled soil while it regrows", () => {
	const inst = createLobby(1, "L", null, 0);
	const f = findWorld(T.field);
	const ripe = tileLayers(inst, f.x, f.y, 0);
	expect(ripe).toHaveLength(1);
	expect(ripe[0]).toMatch(/^field:/);
	inst.tiles.set(tileKey(f.x, f.y), { tilled: true, wateredDays: [], regrowAt: 5000 });
	expect(tileLayers(inst, f.x, f.y, 4999)).toEqual(["tilled"]);
	expect(tileLayers(inst, f.x, f.y, 5000)).toEqual(ripe);
});

test("a cut tree is grass until it regrows", () => {
	const inst = createLobby(1, "L", null, 0);
	const t = findWorld(T.tree);
	expect(tileLayers(inst, t.x, t.y, 0).at(-1)).toBe("tree");
	inst.tiles.set(tileKey(t.x, t.y), { wateredDays: [], regrowAt: 5000 });
	expect(tileLayers(inst, t.x, t.y, 0)).toHaveLength(1);
	expect(tileLayers(inst, t.x, t.y, 0)[0]).toMatch(/^grass/);
});
