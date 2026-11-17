import { describe, expect, test } from "bun:test";
import { LAND_PORTAL, LAND_SPAWN } from "../game/chunks";
import { CROPS } from "../game/data/crops";
import {
	CROP_REGROW_MS,
	DAY_MS,
	MAX_ENERGY,
	PLAYER_BOX,
	ROCK_REGROW_MS,
	TREE_REGROW_MS,
	WALK_SPEED,
	type TInstance,
	type TPlayerState,
	canBuild,
	clock,
	createLand,
	createLobby,
	cropStage,
	enter,
	facedTile,
	simulate,
	sleep,
	terrainAt,
	tileKey,
	use,
} from "../game/engine";
import { isWalkableTerrain, T } from "../game/map";
import { fieldCrop, LAND_GATE, SHOP_DOORS, TOWN_SPAWN } from "../game/world";

const T0 = 1_700_000_000_000;

const base = (userId: string) => ({ userId, name: userId, energy: MAX_ENERGY, lastEnergyAt: T0, equipped: "hoe", colour: "#fff" });
const walkable = (inst: TInstance, x: number, y: number) => isWalkableTerrain(terrainAt(inst, x, y, T0));

// A land seed whose spawn row and east edge are open, so movement tests only hit what they mean to
const SEED = (() => {
	for (let s = 1; s < 5000; s++) {
		const l = createLand("land:probe", "u1", s, T0);
		const open = [8, 9, 10, 11, 12, 13].every((x) => walkable(l, x, 9)) && [[30, 9], [31, 9], [31, 10]].every(([x, y]) => walkable(l, x!, y!));
		if (open) return s;
	}
	throw new Error("no open seed");
})();

function land(owner = "u1") {
	const inst = createLand("land:a", owner, SEED, T0);
	const p = enter(inst, base("u1"));
	return { inst, p };
}

function lobby() {
	const inst = createLobby(1, "Lobby 1", null, T0);
	const p = enter(inst, base("u1"));
	return { inst, p };
}

// Stand one tile left of the first matching tile, facing it
function standLeftOf(inst: TInstance, p: TPlayerState, pred: (x: number, y: number) => boolean, x0: number, y0: number, x1: number, y1: number) {
	for (let y = y0; y <= y1; y++)
		for (let x = x0; x <= x1; x++)
			if (pred(x, y) && walkable(inst, x - 1, y)) {
				p.x = x - 0.5;
				p.y = y + 0.5;
				p.facing = "r";
				return { x, y };
			}
	throw new Error("no matching tile");
}

const run = (r: ReturnType<typeof use>) => (r.apply?.(), r);

describe("clock", () => {
	test("starts at day 1, 06:00 and rolls over", () => {
		expect(clock(T0, T0)).toMatchObject({ day: 1, label: "06:00" });
		expect(clock(T0, T0 + 12 * 60 * 1000).label).toBe("18:00");
		expect(clock(T0, T0 + DAY_MS).day).toBe(2);
	});
});

describe("instances", () => {
	test("enter places players at the spawn tile centre", () => {
		expect(land().p).toMatchObject({ x: LAND_SPAWN.x + 0.5, y: LAND_SPAWN.y + 0.5, facing: "d" });
		expect(lobby().p).toMatchObject({ x: TOWN_SPAWN.x + 0.5, y: TOWN_SPAWN.y + 0.5 });
	});
	test("enter keeps a walkable `at` and ignores a blocked or non-finite one", () => {
		const { inst } = land();
		expect(enter(inst, base("u2"), { x: 9.5, y: 10.5, facing: "l" })).toMatchObject({ x: 9.5, y: 10.5, facing: "l" });
		expect(enter(inst, base("u3"), { x: 40.5, y: 9.5, facing: "l" })).toMatchObject({ x: LAND_SPAWN.x + 0.5, facing: "d" });
		expect(enter(inst, base("u4"), { x: NaN, y: 9.5, facing: "l" })).toMatchObject({ x: LAND_SPAWN.x + 0.5 });
	});
	test("non-finite coordinates are blocked", () => {
		for (const inst of [land().inst, lobby().inst]) {
			expect(isWalkableTerrain(terrainAt(inst, NaN, 0, T0))).toBe(false);
			expect(isWalkableTerrain(terrainAt(inst, 0, Infinity, T0))).toBe(false);
		}
	});
	test("only the owner can build, and never in a lobby", () => {
		expect(canBuild(land().inst, "u1")).toBe(true);
		expect(canBuild(land().inst, "u2")).toBe(false);
		expect(canBuild(lobby().inst, "u1")).toBe(false);
	});
});

describe("movement", () => {
	test("simulate moves at WALK_SPEED", () => {
		const { inst, p } = land();
		const x0 = p.x;
		simulate(inst, "u1", 1, 0, 1000, T0);
		expect(Math.abs(p.x - (x0 + 4.5))).toBeLessThan(1e-9);
		expect(p.facing).toBe("r");
	});
	test("diagonal is normalised", () => {
		const { inst, p } = land();
		const { x: x0, y: y0 } = p;
		simulate(inst, "u1", 1, 1, 1000, T0);
		expect(p.x - x0).toBeCloseTo(WALK_SPEED / Math.SQRT2, 9);
		expect(p.y - y0).toBeCloseTo(WALK_SPEED / Math.SQRT2, 9);
	});
	test("cannot outrun WALK_SPEED", () => {
		const a = land();
		const b = land();
		for (let i = 0; i < 100; i++) simulate(a.inst, "u1", 1, 1, 10, T0);
		simulate(b.inst, "u1", 1, 1, 1000, T0);
		expect(Math.abs(a.p.x - b.p.x)).toBeLessThan(1e-6);
		expect(Math.abs(a.p.y - b.p.y)).toBeLessThan(1e-6);
	});
	test("a long dtMs moves at most one second", () => {
		const { inst, p } = land();
		const x0 = p.x;
		simulate(inst, "u1", 1, 0, 1e12, T0);
		expect(p.x - x0).toBeCloseTo(WALK_SPEED, 9);
	});
	test("locked chunk blocks", () => {
		const { inst, p } = land();
		p.x = 31.0;
		p.y = 9.5;
		simulate(inst, "u1", 1, 0, 1000, T0);
		expect(p.x).toBeCloseTo(32 - PLAYER_BOX / 2, 9);
	});
	test("slides along walls", () => {
		const { inst, p } = land();
		p.x = 31.5;
		p.y = 9.5;
		simulate(inst, "u1", 1, 1, 200, T0);
		expect(p.x).toBeCloseTo(32 - PLAYER_BOX / 2, 9);
		expect(p.y).toBeCloseTo(9.5 + (WALK_SPEED / Math.SQRT2) * 0.2, 9);
	});
	test("no input leaves the player where they are", () => {
		const { inst, p } = land();
		simulate(inst, "u1", 0, 0, 1000, T0);
		expect(p).toMatchObject({ x: LAND_SPAWN.x + 0.5, y: LAND_SPAWN.y + 0.5, facing: "d" });
	});
	test("facedTile is the tile 0.8 ahead of the centre", () => {
		const { p } = land();
		p.facing = "r";
		expect(facedTile(p)).toEqual({ x: LAND_SPAWN.x + 1, y: LAND_SPAWN.y });
		p.facing = "u";
		expect(facedTile(p)).toEqual({ x: LAND_SPAWN.x, y: LAND_SPAWN.y - 1 });
	});
});

describe("farming on your land", () => {
	test("hoe tills plain grass on your land", () => {
		const { inst, p } = land();
		p.facing = "r";
		const t = facedTile(p);
		expect(terrainAt(inst, t.x, t.y, T0)).toBe(T.grass);
		const r = run(use(inst, "u1", T0, {}));
		expect(r).toMatchObject({ ok: true, energyCost: 2 });
		expect(inst.tiles.get(tileKey(t.x, t.y))?.tilled).toBe(true);
	});

	test("only the owner can till", () => {
		const { inst } = land("u1");
		const bob = enter(inst, base("u2"));
		bob.facing = "r";
		expect(use(inst, "u2", T0, {})).toMatchObject({ ok: false, msg: "This isn't your land." });
	});

	test("till, plant, water daily, harvest", () => {
		const { inst, p } = land();
		p.facing = "r";
		const t = facedTile(p);
		const inv = { parsnip_seed: 3 };

		expect(run(use(inst, "u1", T0, inv)).msg).toContain("till");
		p.equipped = "parsnip_seed";
		const plant = run(use(inst, "u1", T0, inv));
		expect(plant.take).toEqual({ parsnip_seed: 1 });

		const tile = inst.tiles.get(tileKey(t.x, t.y))!;
		p.equipped = "watering_can";
		// parsnip needs 2 watered days
		for (let d = 0; d < 2; d++) expect(run(use(inst, "u1", T0 + d * DAY_MS, inv)).ok).toBe(true);
		expect(cropStage(tile, 2)!.ready).toBe(false);
		expect(cropStage(tile, 3)!.ready).toBe(true);

		const harvest = run(use(inst, "u1", T0 + 2 * DAY_MS, inv));
		expect(harvest.give).toEqual({ parsnip: 1 });
		expect(inst.tiles.get(tileKey(t.x, t.y))!.cropId).toBeUndefined();
	});

	test("cannot water twice a day or plant without seeds", () => {
		const { inst, p } = land();
		p.facing = "r";
		run(use(inst, "u1", T0, {}));
		p.equipped = "watering_can";
		run(use(inst, "u1", T0, {}));
		expect(use(inst, "u1", T0, {}).msg).toContain("Already watered");
		p.equipped = "parsnip_seed";
		expect(use(inst, "u1", T0, {}).ok).toBe(false);
	});

	test("energy runs out", () => {
		const { inst, p } = land();
		p.energy = 1;
		p.facing = "r";
		expect(use(inst, "u1", T0, {}).msg).toContain("tired");
	});
});

describe("travel and shop", () => {
	test("portal returns travel", () => {
		const w = lobby();
		w.p.x = LAND_GATE.x + 0.5;
		w.p.y = LAND_GATE.y + 1.5;
		w.p.facing = "u";
		expect(use(w.inst, "u1", T0, {})).toMatchObject({ ok: true, travel: "land" });

		const l = land();
		l.p.x = LAND_PORTAL.x + 1.5;
		l.p.y = LAND_PORTAL.y + 0.5;
		l.p.facing = "l";
		expect(use(l.inst, "u1", T0, {})).toMatchObject({ ok: true, travel: "world" });
	});

	test("shop door opens the shop", () => {
		const { inst, p } = lobby();
		const door = SHOP_DOORS[0]!;
		p.x = door.x + 0.5;
		p.y = door.y + 1.5;
		p.facing = "u";
		expect(use(inst, "u1", T0, {})).toMatchObject({ ok: true, menu: "shop" });
	});
});

describe("public land", () => {
	const READ_ONLY = "You can only build on your own land.";

	test("public land is read-only", () => {
		const { inst, p } = lobby();
		standLeftOf(inst, p, (x, y) => terrainAt(inst, x, y, T0) === T.grass, -60, -40, 60, 40);
		expect(use(inst, "u1", T0, {})).toMatchObject({ ok: false, msg: READ_ONLY });
		p.equipped = "parsnip_seed";
		expect(use(inst, "u1", T0, { parsnip_seed: 1 })).toMatchObject({ ok: false, msg: READ_ONLY });
		p.equipped = "watering_can";
		expect(use(inst, "u1", T0, {})).toMatchObject({ ok: false, msg: "Nothing to do here." });
		expect(inst.tiles.size).toBe(0);
	});

	test("public tools on targets that could never be farmed do nothing", () => {
		const { inst, p } = lobby();
		standLeftOf(inst, p, (x, y) => terrainAt(inst, x, y, T0) === T.path, -60, -40, 60, 40);
		p.equipped = "watering_can";
		expect(use(inst, "u1", T0, {}).msg).toBe("Nothing to do here.");
		p.equipped = "parsnip_seed";
		expect(use(inst, "u1", T0, { parsnip_seed: 1 }).msg).toBe("Nothing to do here.");
	});

	test("public crops harvest and regrow", () => {
		const { inst, p } = lobby();
		let at: { x: number; y: number } | undefined;
		for (let x = -500; x < 500 && !at; x++)
			for (let y = -10; y <= 10; y++)
				if (fieldCrop(x, y) && walkable(inst, x - 1, y)) {
					at = { x, y };
					break;
				}
		const { x, y } = standLeftOf(inst, p, (x, y) => x === at!.x && y === at!.y, at!.x, at!.y, at!.x, at!.y);
		const crop = CROPS[fieldCrop(x, y)!]!;
		const first = run(use(inst, "u1", T0, {}));
		expect(first).toMatchObject({ ok: true, give: { [crop.yieldItem]: crop.yieldQty }, changedTiles: [tileKey(x, y)] });
		const tile = inst.tiles.get(tileKey(x, y))!;
		expect(tile).toMatchObject({ tilled: true, regrowAt: T0 + CROP_REGROW_MS });
		expect(terrainAt(inst, x, y, T0)).toBe(T.field);
		expect(use(inst, "u1", T0 + CROP_REGROW_MS - 1, {})).toMatchObject({ ok: false, msg: "This is still growing." });
		expect(run(use(inst, "u1", T0 + CROP_REGROW_MS, {})).ok).toBe(true);
	});

	test("public trees and rocks regrow in minutes", () => {
		const { inst, p } = lobby();
		p.equipped = "axe";
		const tree = standLeftOf(inst, p, (x, y) => terrainAt(inst, x, y, T0) === T.tree, -60, -40, 60, 40);
		expect(run(use(inst, "u1", T0, {})).give).toEqual({ wood: 3 });
		expect(inst.tiles.get(tileKey(tree.x, tree.y))?.regrowAt).toBe(T0 + TREE_REGROW_MS);
		expect(terrainAt(inst, tree.x, tree.y, T0 + TREE_REGROW_MS - 1)).toBe(T.grass);
		expect(terrainAt(inst, tree.x, tree.y, T0 + TREE_REGROW_MS)).toBe(T.tree);

		p.equipped = "pickaxe";
		const rock = standLeftOf(inst, p, (x, y) => terrainAt(inst, x, y, T0) === T.rock, -60, -40, 60, 40);
		expect(run(use(inst, "u1", T0, {})).ok).toBe(true);
		expect(inst.tiles.get(tileKey(rock.x, rock.y))?.regrowAt).toBe(T0 + ROCK_REGROW_MS);
		expect(terrainAt(inst, rock.x, rock.y, T0 + ROCK_REGROW_MS - 1)).toBe(T.grass);
		expect(terrainAt(inst, rock.x, rock.y, T0 + ROCK_REGROW_MS)).toBe(T.rock);
	});
});

describe("resources on your land", () => {
	test("chopped trees clear and respawn after 3 days", () => {
		const { inst, p } = land();
		p.equipped = "axe";
		const t = standLeftOf(inst, p, (x, y) => terrainAt(inst, x, y, T0) === T.tree, -15, -15, 47, 47);
		expect(run(use(inst, "u1", T0, {})).give).toEqual({ wood: 3 });
		expect(terrainAt(inst, t.x, t.y, T0)).toBe(T.grass);
		expect(terrainAt(inst, t.x, t.y, T0 + 2 * DAY_MS)).toBe(T.grass);
		expect(terrainAt(inst, t.x, t.y, T0 + 3 * DAY_MS)).toBe(T.tree);
	});

	test("only mining a rock is marked mined (the server rolls gems)", () => {
		const { inst, p } = land();
		p.equipped = "pickaxe";
		standLeftOf(inst, p, (x, y) => terrainAt(inst, x, y, T0) === T.rock, -15, -15, 47, 47);
		expect(use(inst, "u1", T0, {})).toMatchObject({ ok: true, mined: true });
		p.equipped = "axe";
		standLeftOf(inst, p, (x, y) => terrainAt(inst, x, y, T0) === T.tree, -15, -15, 47, 47);
		expect(use(inst, "u1", T0, {}).mined).toBeUndefined();
	});

	test("mined rocks give ore and respawn after 2 days", () => {
		const { inst, p } = land();
		p.equipped = "pickaxe";
		const t = standLeftOf(inst, p, (x, y) => terrainAt(inst, x, y, T0) === T.rock, -15, -15, 47, 47);
		const r = run(use(inst, "u1", T0, {}));
		const [[ore, qty]] = Object.entries(r.give!) as [[string, number]];
		expect(["stone", "copper", "iron", "gold"]).toContain(ore);
		expect(qty).toBe(ore === "stone" ? 2 : 1);
		expect(terrainAt(inst, t.x, t.y, T0 + DAY_MS)).toBe(T.grass);
		expect(terrainAt(inst, t.x, t.y, T0 + 2 * DAY_MS)).toBe(T.rock);
	});

	test("chop then till keeps the tile clear forever", () => {
		const { inst, p } = land();
		p.equipped = "axe";
		const t = standLeftOf(inst, p, (x, y) => terrainAt(inst, x, y, T0) === T.tree, -15, -15, 47, 47);
		run(use(inst, "u1", T0, {}));
		p.equipped = "hoe";
		expect(run(use(inst, "u1", T0, {})).ok).toBe(true);
		expect(inst.tiles.get(tileKey(t.x, t.y))).toMatchObject({ tilled: true, clearedDay: 1 });
		expect(terrainAt(inst, t.x, t.y, T0)).toBe(T.grass);
		expect(terrainAt(inst, t.x, t.y, T0 + 10 * DAY_MS)).toBe(T.grass);
	});

	test("crop on a cleared tile is not overgrown", () => {
		const { inst, p } = land();
		p.equipped = "pickaxe";
		const t = standLeftOf(inst, p, (x, y) => terrainAt(inst, x, y, T0) === T.rock, -15, -15, 47, 47);
		run(use(inst, "u1", T0, {}));
		p.equipped = "hoe";
		run(use(inst, "u1", T0, {}));
		p.equipped = "parsnip_seed";
		expect(run(use(inst, "u1", T0, { parsnip_seed: 1 })).ok).toBe(true);
		const tile = inst.tiles.get(tileKey(t.x, t.y))!;
		tile.tilled = false; // even if the soil state were lost, the crop keeps the tile clear
		expect(terrainAt(inst, t.x, t.y, T0 + 10 * DAY_MS)).toBe(T.grass);
	});

	test("visitors cannot chop on someone else's land", () => {
		const { inst } = land("u1");
		const bob = enter(inst, base("u2"));
		bob.equipped = "axe";
		standLeftOf(inst, bob, (x, y) => terrainAt(inst, x, y, T0) === T.tree, -15, -15, 47, 47);
		expect(use(inst, "u2", T0, {})).toMatchObject({ ok: false, msg: "This isn't your land." });
	});
});

describe("animals", () => {
	test("hits an animal in front before any tile action", () => {
		const { inst, p } = land();
		p.facing = "r";
		const animals = [
			{ id: 1, x: p.x + 5, y: p.y },
			{ id: 7, x: p.x + 0.8 + 1.0, y: p.y },
		];
		const r = run(use(inst, "u1", T0, {}, animals));
		expect(r).toMatchObject({ ok: true, hitAnimalId: 7, energyCost: 2 });
		expect(inst.tiles.size).toBe(0);
		expect(use(inst, "u1", T0, {}, [{ id: 1, x: p.x + 3, y: p.y }]).hitAnimalId).toBeUndefined();
	});
});

describe("sleep", () => {
	test("sleep only at the house door after 18:00", () => {
		const { inst, p } = land();
		p.energy = 10;
		const evening = T0 + 13 * 60 * 1000;
		expect(sleep(inst, "u1", evening).ok).toBe(false); // spawn faces down, away from the door
		p.x = 8.5;
		p.y = 8.5;
		p.facing = "u";
		expect(sleep(inst, "u1", T0).msg).toContain("too early");
		run(sleep(inst, "u1", evening));
		expect(p.energy).toBe(MAX_ENERGY);

		const bob = enter(inst, base("u2"), { x: 8.5, y: 8.5, facing: "u" });
		expect(bob.facing).toBe("u");
		expect(sleep(inst, "u2", evening)).toMatchObject({ ok: false, msg: "You can only sleep in your own house." });

		const w = lobby();
		expect(sleep(w.inst, "u1", evening).ok).toBe(false);
	});
});
