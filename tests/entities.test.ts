import { describe, expect, test } from "bun:test";
import { CHUNK } from "../game/chunks";
import { ANIMAL_RESPAWN_MS, PLAYER_BOX, createLobby, terrainAt, type TInstance } from "../game/engine";
import { ANIMAL_HP, ANIMALS, hitAnimal, spawnAnimals, tickAnimal, type TAnimal, type TAnimalKind } from "../game/entities";
import { isWalkableTerrain, prng } from "../game/map";
import { WORLD_CHUNKS, regionAt, worldTerrain } from "../game/world";

const HALF = WORLD_CHUNKS / 2;
const T0 = 1_000_000;

// Every animal in the world, spawned once per chunk
const world: { cx: number; cy: number; animals: TAnimal[] }[] = [];
for (let cy = -HALF; cy < HALF; cy++) for (let cx = -HALF; cx < HALF; cx++) world.push({ cx, cy, animals: spawnAnimals(cx, cy) });

function findAnimal(kind: TAnimalKind, ok: (a: TAnimal) => boolean = () => true): TAnimal {
	for (const c of world) for (const a of c.animals) if (a.kind === kind && ok(a)) return { ...a };
	throw new Error(`no ${kind}`);
}

const walk = (x: number, y: number) => isWalkableTerrain(worldTerrain(x, y));

// True when the animal's box touches only walkable tiles
function fits(inst: TInstance, a: TAnimal, now: number) {
	const h = PLAYER_BOX / 2 - 1e-6;
	for (const [dx, dy] of [[-h, -h], [h, -h], [-h, h], [h, h]] as const)
		if (!isWalkableTerrain(terrainAt(inst, a.x + dx, a.y + dy, now))) return false;
	return true;
}

// Ten simulated minutes of 50 ms ticks; every few seconds a player walks up to the animal
function live(a: TAnimal, inst: TInstance, each: (now: number) => void) {
	const rand = prng(7);
	let player: { x: number; y: number } | null = null;
	for (let now = T0; now < T0 + 10 * 60_000; now += 50) {
		if ((now - T0) % 7000 === 0) player = rand() < 0.5 ? { x: a.x + (rand() - 0.5) * 3, y: a.y + (rand() - 0.5) * 3 } : null;
		const near = player ? { ...player, d: Math.hypot(a.x - player.x, a.y - player.y) } : null;
		tickAnimal(a, inst, near, now, 50, rand);
		each(now);
	}
}

describe("entities", () => {
	test("spawnAnimals is deterministic and region-correct", () => {
		expect(spawnAnimals(3, 7)).toEqual(spawnAnimals(3, 7));
		const ids = new Set<number>();
		const kinds = new Set<string>();
		let meadowOnly = 0;
		for (const { cx, cy, animals } of world) {
			for (const a of animals) {
				expect(Number.isSafeInteger(a.id)).toBe(true);
				expect(ids.has(a.id)).toBe(false);
				ids.add(a.id);
				kinds.add(a.kind);
				// On a walkable tile of its chunk, at home, alive
				expect(walk(Math.floor(a.x), Math.floor(a.y))).toBe(true);
				expect(Math.floor(a.x / CHUNK)).toBe(cx);
				expect(Math.floor(a.y / CHUNK)).toBe(cy);
				expect(a).toMatchObject({ homeX: a.x, homeY: a.y, hp: ANIMAL_HP[a.kind] });
				expect(a.state).not.toBe("dead");
			}
			// Sample the chunk on a 4-tile grid for a meadow-only check
			let meadow = true;
			for (let j = 0; j < CHUNK && meadow; j += 4)
				for (let i = 0; i < CHUNK && meadow; i += 4) meadow = regionAt(cx * CHUNK + i, cy * CHUNK + j) === "meadow";
			if (meadow) {
				meadowOnly++;
				expect(animals.every((a) => a.kind === "rabbit")).toBe(true);
			}
		}
		expect(meadowOnly).toBeGreaterThan(0);
		expect([...kinds].sort()).toEqual(["boar", "deer", "duck", "rabbit"]);
		// No animals in town
		expect(spawnAnimals(0, 0)).toEqual([]);
	});

	test("flees from a close player", () => {
		const inst = createLobby(1, "L", null, 0);
		// A rabbit with open ground to its west
		const a = findAnimal("rabbit", (r) => [1, 2, 3, 4].every((k) => walk(Math.floor(r.x) - k, Math.floor(r.y))));
		const player = { x: a.x + 2, y: a.y };
		const dist = () => Math.hypot(a.x - player.x, a.y - player.y);
		const rand = prng(1);
		tickAnimal(a, inst, { ...player, d: dist() }, T0, 50, rand);
		expect(a.state).toBe("flee");
		expect(a.facing).toBe("l");
		for (let t = 50; t <= 500; t += 50) tickAnimal(a, inst, { ...player, d: dist() }, T0 + t, 50, rand);
		expect(dist()).toBeGreaterThan(2 + 0.5 * ANIMALS.rabbit.fleeSpeed * 0.9);
	});

	test("stays near home", () => {
		const inst = createLobby(1, "L", null, 0);
		for (const kind of ["rabbit", "deer", "duck", "boar"] as const) {
			const a = findAnimal(kind);
			let far = 0;
			let moved = false;
			live(a, inst, () => {
				far = Math.max(far, Math.hypot(a.x - a.homeX, a.y - a.homeY));
				moved ||= a.x !== a.homeX;
			});
			expect(moved).toBe(true);
			expect(far).toBeLessThanOrEqual(12);
		}
	});

	test("blocked by walls", () => {
		const inst = createLobby(1, "L", null, 0);
		// Forest animals live among trees
		for (const a of [findAnimal("deer"), findAnimal("boar"), findAnimal("rabbit", (r) => regionAt(r.x, r.y) === "forest")]) {
			let bad = 0;
			live(a, inst, (now) => {
				if (!fits(inst, a, now)) bad++;
			});
			expect(bad).toBe(0);
		}
	});

	test("slaughter drops and respawns", () => {
		const inst = createLobby(1, "L", null, 0);
		const a = findAnimal("deer");
		expect(a.hp).toBe(3);
		expect(hitAnimal(a, T0)).toEqual({ killed: false });
		expect(a.state).toBe("flee");
		// It runs off
		for (let t = 50; t <= 1000; t += 50) tickAnimal(a, inst, null, T0 + t, 50, prng(2));
		expect(hitAnimal(a, T0 + 1000)).toEqual({ killed: false });
		expect(hitAnimal(a, T0 + 1100)).toEqual({ killed: true, drops: { venison: 2, hide: 2 } });
		expect(a).toMatchObject({ state: "dead", hp: 0, until: T0 + 1100 + ANIMAL_RESPAWN_MS });
		// A dead animal can't be hit again and stays dead until its time
		expect(hitAnimal(a, T0 + 1200)).toEqual({ killed: false });
		tickAnimal(a, inst, null, T0 + 1100 + ANIMAL_RESPAWN_MS - 1, 50, prng(2));
		expect(a.state).toBe("dead");
		tickAnimal(a, inst, null, T0 + 1100 + ANIMAL_RESPAWN_MS, 50, prng(2));
		expect(a).toMatchObject({ state: "idle", hp: 3, x: a.homeX, y: a.homeY });
	});
});
