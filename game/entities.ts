// Wild animals in the open world: deterministic spawns, idle/wander/flee AI, slaughter and respawn. Pure and shared.
import { CHUNK } from "./chunks";
import { ANIMAL_RESPAWN_MS, DIRS, moveBody, type TDir, type TInstance } from "./engine";
import { isWalkableTerrain, prng } from "./map";
import { WORLD_SEED, regionAt, worldTerrain, type TRegion } from "./world";

// Phase 1: passive wildlife that can be slaughtered
export type TAnimalKind = "rabbit" | "deer" | "duck" | "boar";

export interface TAnimal {
	id: number;
	kind: TAnimalKind;
	x: number;
	y: number;
	facing: TDir;
	homeX: number;
	homeY: number;
	state: "idle" | "wander" | "flee" | "dead";
	/** When the current state ends (idle, wander, flee) or the animal respawns (dead) */
	until: number;
	hp: number;
	/** Wander target */
	tx?: number;
	ty?: number;
}

export const ANIMAL_HP: Record<TAnimalKind, number> = { rabbit: 1, duck: 1, deer: 3, boar: 4 };

export const ANIMAL_DROPS: Record<TAnimalKind, Record<string, number>> = {
	rabbit: { raw_meat: 1, hide: 1 },
	duck: { raw_meat: 1, feather: 2 },
	deer: { venison: 2, hide: 2 },
	boar: { raw_meat: 3, hide: 1 },
};

/** Speeds in tiles per second; flee radius in tiles; perChunk is the expected count in a chunk of a matching region */
export const ANIMALS: Record<TAnimalKind, { speed: number; fleeSpeed: number; fleeRadius: number; regions: TRegion[]; perChunk: number }> = {
	rabbit: { speed: 2, fleeSpeed: 5.5, fleeRadius: 3, regions: ["meadow", "forest"], perChunk: 1.5 },
	deer: { speed: 2.5, fleeSpeed: 6, fleeRadius: 5, regions: ["forest", "wilds"], perChunk: 0.6 },
	duck: { speed: 1.5, fleeSpeed: 3, fleeRadius: 3, regions: ["lake"], perChunk: 1 },
	boar: { speed: 2, fleeSpeed: 4, fleeRadius: 2, regions: ["forest", "wilds"], perChunk: 0.4 },
};

const KINDS = Object.keys(ANIMALS) as TAnimalKind[];
const FLEE_MS = 2000;
const WANDER_RADIUS = 6;
const LEASH = 12;
const SPAWN_TRIES = 8;
const FACINGS: TDir[] = ["u", "d", "l", "r"];

/** Unique per chunk and index; fits a safe integer for any chunk within ±32768 */
export const animalId = (cx: number, cy: number, i: number) => ((cx + 32768) * 65536 + (cy + 32768)) * 16 + i;

const chunkSeed = (cx: number, cy: number) =>
	Math.imul(WORLD_SEED, 0x9e3779b1) ^ Math.imul(cx, 0x85ebca6b) ^ Math.imul(cy, 0xc2b2ae35) ^ 0x51ed27;

/**
 * The animals of one world chunk, the same every time. The chunk's centre region decides which kinds live there;
 * count = floor(perChunk) plus one more with chance frac(perChunk); each stands at a walkable tile centre.
 */
export function spawnAnimals(cx: number, cy: number): TAnimal[] {
	const rand = prng(chunkSeed(cx, cy));
	const region = regionAt(cx * CHUNK + CHUNK / 2, cy * CHUNK + CHUNK / 2);
	const out: TAnimal[] = [];
	for (const kind of KINDS) {
		const spec = ANIMALS[kind];
		const roll = rand();
		if (!spec.regions.includes(region)) continue;
		const n = Math.floor(spec.perChunk) + (roll < spec.perChunk % 1 ? 1 : 0);
		for (let k = 0; k < n; k++)
			for (let t = 0; t < SPAWN_TRIES; t++) {
				const x = cx * CHUNK + Math.floor(rand() * CHUNK);
				const y = cy * CHUNK + Math.floor(rand() * CHUNK);
				if (!isWalkableTerrain(worldTerrain(x, y))) continue;
				const facing = FACINGS[Math.floor(rand() * 4)] as TDir;
				out.push({ id: animalId(cx, cy, out.length), kind, x: x + 0.5, y: y + 0.5, facing, homeX: x + 0.5, homeY: y + 0.5, state: "idle", until: 0, hp: ANIMAL_HP[kind] });
				break;
			}
	}
	return out;
}

/** −1 hp and the animal flees; at 0 hp it dies, drops its loot and respawns at home after ANIMAL_RESPAWN_MS */
export function hitAnimal(a: TAnimal, now: number): { killed: boolean; drops?: Record<string, number> } {
	if (a.state === "dead") return { killed: false };
	a.hp--;
	if (a.hp > 0) {
		a.state = "flee";
		a.until = now + FLEE_MS;
		return { killed: false };
	}
	a.hp = 0;
	a.state = "dead";
	a.until = now + ANIMAL_RESPAWN_MS;
	return { killed: true, drops: { ...ANIMAL_DROPS[a.kind] } };
}

function rest(a: TAnimal, now: number, rand: () => number) {
	a.state = "idle";
	a.until = now + 1000 + rand() * 3000;
	a.tx = a.ty = undefined;
}

// Moves toward (dx, dy) with player collision, never past the leash. False when it did not move.
function step(a: TAnimal, inst: TInstance, dx: number, dy: number, dist: number, now: number): boolean {
	const { x, y } = a;
	if (dx !== 0 || dy !== 0) a.facing = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "r" : "l") : dy > 0 ? "d" : "u";
	moveBody(inst, a, dx, dy, dist, now);
	if (Math.hypot(a.x - a.homeX, a.y - a.homeY) > LEASH) {
		a.x = x;
		a.y = y;
	}
	return a.x !== x || a.y !== y;
}

/**
 * One AI step. Idle 1–4 s, then wander to a random point within 6 tiles of home, then idle again.
 * A player within fleeRadius makes it run directly away at fleeSpeed until 2 s after the last scare.
 */
export function tickAnimal(
	a: TAnimal,
	inst: TInstance,
	nearestPlayer: { x: number; y: number; d: number } | null,
	now: number,
	dtMs: number,
	rand: () => number,
): void {
	if (a.state === "dead") {
		if (now < a.until) return;
		a.x = a.homeX;
		a.y = a.homeY;
		a.hp = ANIMAL_HP[a.kind];
		rest(a, now, rand);
		return;
	}
	const spec = ANIMALS[a.kind];
	const secs = Math.min(Math.max(dtMs, 0), 1000) / 1000;
	if (nearestPlayer && nearestPlayer.d <= spec.fleeRadius) {
		a.state = "flee";
		a.until = now + FLEE_MS;
	}
	if (a.state === "flee") {
		if (now >= a.until) return rest(a, now, rand);
		const p = nearestPlayer;
		const [dx, dy] = p && p.d > 0 ? [a.x - p.x, a.y - p.y] : DIRS[a.facing];
		step(a, inst, dx, dy, spec.fleeSpeed * secs, now);
		return;
	}
	if (a.state === "idle") {
		if (now < a.until) return;
		const angle = rand() * Math.PI * 2;
		const r = Math.sqrt(rand()) * WANDER_RADIUS;
		a.tx = a.homeX + Math.cos(angle) * r;
		a.ty = a.homeY + Math.sin(angle) * r;
		a.state = "wander";
		a.until = now + (Math.hypot(a.tx - a.x, a.ty - a.y) / spec.speed) * 1000 + 1000;
	}
	const tx = a.tx ?? a.homeX;
	const ty = a.ty ?? a.homeY;
	const dist = spec.speed * secs;
	const left = Math.hypot(tx - a.x, ty - a.y);
	// Arrived, out of time, or stuck against something
	if (now >= a.until || !step(a, inst, tx - a.x, ty - a.y, Math.min(dist, left), now) || left <= dist) rest(a, now, rand);
}
