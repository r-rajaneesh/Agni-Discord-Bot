import { describe, expect, test } from "bun:test";
import { DAY_MS, clock, createWorld, cropStage, joinWorld, move, sleep, terrainAt, tileKey, use } from "../game/engine";
import { PLOTS, T, baseTerrain } from "../game/map";

const T0 = 1_700_000_000_000;

function setup() {
	const world = createWorld("g1", T0);
	const p = joinWorld(world, "u1", "Alice", T0);
	return { world, p };
}

// Stand just left of the plot's first tile, facing right
function standAtPlot(p: ReturnType<typeof setup>["p"]) {
	const plot = PLOTS[p.plotId!]!;
	p.x = plot.x - 1;
	p.y = plot.y;
	p.facing = "r";
	return { x: plot.x, y: plot.y };
}

const run = (r: ReturnType<typeof use>) => (r.apply?.(), r);

describe("clock", () => {
	test("starts at day 1, 06:00 and rolls over", () => {
		expect(clock(T0, T0)).toMatchObject({ day: 1, label: "06:00" });
		expect(clock(T0, T0 + 12 * 60 * 1000).label).toBe("18:00");
		expect(clock(T0, T0 + DAY_MS).day).toBe(2);
	});
});

describe("join", () => {
	test("claims a free plot and keeps it on rejoin", () => {
		const { world, p } = setup();
		expect(p.plotId).toBe(0);
		expect(world.plotOwners[0]).toBe("u1");
		joinWorld(world, "u1", "Alice", T0);
		expect(world.plotOwners.filter((o) => o === "u1")).toHaveLength(1);
		expect(joinWorld(world, "u2", "Bob", T0).plotId).toBe(1);
	});
	test("players beyond the plot count get no plot", () => {
		const world = createWorld("g", T0);
		for (let i = 0; i < PLOTS.length; i++) joinWorld(world, `u${i}`, "x", T0);
		expect(joinWorld(world, "late", "Late", T0).plotId).toBeNull();
	});
});

describe("movement", () => {
	test("moves onto walkable tiles and blocks on trees and players", () => {
		const { world, p } = setup();
		const start = { x: p.x, y: p.y };
		expect(move(world, "u1", "d", T0).ok).toBe(true);
		expect(p.y).toBe(start.y + 1);
		p.x = 0;
		p.y = 5;
		expect(baseTerrain(0, 5)).toBe(T.tree);
		p.x = 1;
		p.facing = "l";
		expect(move(world, "u1", "l", T0).ok).toBe(false);
		expect(p.x).toBe(1);
		const bob = joinWorld(world, "u2", "Bob", T0);
		bob.x = 2;
		bob.y = 5;
		p.facing = "r";
		expect(move(world, "u1", "r", T0).msg).toContain("Bob");
	});

	test("pressing a new direction only turns; pressing it again moves", () => {
		const { world, p } = setup();
		const start = { x: p.x, y: p.y };
		p.facing = "d";
		for (const dir of ["u", "l"] as const) {
			const before = { x: p.x, y: p.y };
			expect(move(world, "u1", dir, T0).ok).toBe(true);
			expect(p).toMatchObject({ ...before, facing: dir });
			move(world, "u1", dir, T0);
		}
		expect(p).toMatchObject({ x: start.x - 1, y: start.y - 1, facing: "l" });
	});
});

describe("farming", () => {
	test("till → plant → water daily → harvest", () => {
		const { world, p } = setup();
		const t = standAtPlot(p);
		const inv = { parsnip_seed: 3 };

		expect(run(use(world, "u1", T0, inv)).msg).toContain("till");
		p.equipped = "parsnip_seed";
		const plant = run(use(world, "u1", T0, inv));
		expect(plant.take).toEqual({ parsnip_seed: 1 });

		const tile = world.tiles.get(tileKey(t.x, t.y))!;
		p.equipped = "watering_can";
		// parsnip needs 2 watered days
		for (let d = 0; d < 2; d++) expect(run(use(world, "u1", T0 + d * DAY_MS, inv)).ok).toBe(true);
		expect(cropStage(tile, 2)!.ready).toBe(false);
		expect(cropStage(tile, 3)!.ready).toBe(true);

		const harvest = run(use(world, "u1", T0 + 2 * DAY_MS, inv));
		expect(harvest.give).toEqual({ parsnip: 1 });
		expect(world.tiles.get(tileKey(t.x, t.y))!.cropId).toBeUndefined();
	});

	test("cannot water twice a day, plant without seeds, or till someone else's plot", () => {
		const { world, p } = setup();
		standAtPlot(p);
		run(use(world, "u1", T0, {}));
		p.equipped = "watering_can";
		run(use(world, "u1", T0, {}));
		expect(use(world, "u1", T0, {}).msg).toContain("Already watered");
		p.equipped = "parsnip_seed";
		expect(use(world, "u1", T0, {}).ok).toBe(false);

		const bob = joinWorld(world, "u2", "Bob", T0);
		bob.x = p.x;
		bob.y = p.y + 1;
		bob.facing = "r";
		bob.equipped = "hoe";
		expect(use(world, "u2", T0, {}).ok).toBe(false);
	});

	test("energy runs out and sleep restores it after 18:00", () => {
		const { world, p } = setup();
		p.energy = 1;
		standAtPlot(p);
		expect(use(world, "u1", T0, {}).msg).toContain("tired");
		expect(sleep(world, "u1", T0).ok).toBe(false);
		run(sleep(world, "u1", T0 + 13 * 60 * 1000));
		expect(p.energy).toBe(100);
	});
});

describe("resources", () => {
	test("chopped trees clear and respawn after 3 days", () => {
		const { world, p } = setup();
		// find an interior tree with a walkable tile to its left
		let tx = -1,
			ty = -1;
		for (let y = 2; y < 30 && tx < 0; y++)
			for (let x = 2; x < 40; x++)
				if (baseTerrain(x, y) === T.tree && baseTerrain(x - 1, y) === T.grass) {
					tx = x;
					ty = y;
					break;
				}
		p.x = tx - 1;
		p.y = ty;
		p.facing = "r";
		p.equipped = "axe";
		expect(run(use(world, "u1", T0, {})).give).toEqual({ wood: 3 });
		expect(terrainAt(world, tx, ty, 1)).toBe(T.grass);
		expect(terrainAt(world, tx, ty, 4)).toBe(T.tree);
	});
});
