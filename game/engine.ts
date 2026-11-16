// Pure game rules. No Discord or Mongo imports, so everything here is unit-testable.
// A game runs in instances: a player's private land, or a public lobby copy of the open world.
import { HOUSE, LAND_SPAWN, START_CHUNKS, landTerrain } from "./chunks";
import { CROPS } from "./data/crops";
import { ITEMS } from "./data/items";
import { T, isWalkableTerrain } from "./map";
import type { TDir } from "./protocol";
import { TOWN_SPAWN, WORLD_SEED, fieldCrop, worldTerrain } from "./world";

export type { TDir };

/** One in-game day (06:00 → 02:00) lasts 20 real minutes; one game minute = one real second. */
export const DAY_MS = 20 * 60 * 1000;
export const MAX_ENERGY = 100;
export const ENERGY_REGEN_MS = 20_000;
const TREE_RESPAWN_DAYS = 3;
const ROCK_RESPAWN_DAYS = 2;

// Gathering in a public lobby grows back after a few real minutes
export const CROP_REGROW_MS = 5 * 60_000;
export const TREE_REGROW_MS = 3 * 60_000;
export const ROCK_REGROW_MS = 2 * 60_000;
export const ANIMAL_RESPAWN_MS = 60_000;

export const WALK_SPEED = 4.5; // tiles per second
export const PLAYER_BOX = 0.6; // tiles, square, centred on the player
export const TICK_MS = 50;
// Movement is applied in steps no longer than this, so a long dtMs cannot pass through a wall
const MAX_STEP = 0.25;
const EPS = 1e-6;
// Reach of the faced point and of an animal hit, in tiles
const REACH = 0.8;
const HIT_RADIUS = 1.2;

export const HOUSE_DOOR = { x: HOUSE.x + 2, y: HOUSE.y + HOUSE.h - 1 };

export const DIRS: Record<TDir, [number, number]> = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };

export interface TTileState {
	tilled?: boolean;
	cropId?: string;
	plantedDay?: number;
	wateredDays: number[];
	/** Day a tree/rock was removed on private land; it grows back after its respawn time */
	clearedDay?: number;
	/** Public lobbies: time (ms) a gathered tree, rock or field grows back */
	regrowAt?: number;
}

export interface TPlayerState {
	userId: string;
	name: string;
	/** Player centre in tile units */
	x: number;
	y: number;
	facing: TDir;
	energy: number;
	lastEnergyAt: number;
	equipped: string;
	colour: string;
	/** Farm Pass holder (cosmetic crown) */
	premium?: boolean;
}

export interface TInstance {
	id: string; // "land:<landId>" | "lobby:<n>"
	kind: "land" | "world";
	lobby?: { n: number; label: string; homeGuildId: string | null }; // world only
	seed: number; // land seed; WORLD_SEED for the world
	ownerId: string | null; // land owner; null for the world
	epoch: number;
	unlocked: Set<string>; // chunk keys; empty for the world (every in-bounds chunk is open)
	tiles: Map<string, TTileState>;
	players: Map<string, TPlayerState>;
}

export interface TActionResult {
	ok: boolean;
	msg: string;
	/** Items the action consumes; the caller must debit them before calling apply() */
	take?: Record<string, number>;
	/** Items the action produces; the caller credits them after apply() */
	give?: Record<string, number>;
	energyCost?: number;
	menu?: "shop";
	/** The player stepped into a portal; the caller moves them to this instance kind */
	travel?: "world" | "land";
	/** An animal was hit; the caller applies the hit */
	hitAnimalId?: number;
	/** Tile keys whose state apply() changes (for persistence) */
	changedTiles?: string[];
	apply?: () => void;
}

export const tileKey = (x: number, y: number) => `${x},${y}`;

export function createLand(id: string, ownerId: string, seed: number, epoch: number): TInstance {
	return { id, kind: "land", seed, ownerId, epoch, unlocked: new Set(START_CHUNKS), tiles: new Map(), players: new Map() };
}

export function createLobby(n: number, label: string, homeGuildId: string | null, epoch: number): TInstance {
	return {
		id: `lobby:${n}`,
		kind: "world",
		lobby: { n, label, homeGuildId },
		seed: WORLD_SEED,
		ownerId: null,
		epoch,
		unlocked: new Set(),
		tiles: new Map(),
		players: new Map(),
	};
}

export function clock(epoch: number, now: number) {
	const elapsed = Math.max(0, now - epoch);
	const day = Math.floor(elapsed / DAY_MS) + 1;
	const minuteOfDay = 6 * 60 + Math.floor((elapsed % DAY_MS) / 1000);
	const hh = Math.floor(minuteOfDay / 60) % 24;
	const mm = Math.floor(minuteOfDay % 60 / 10) * 10;
	return { day, minuteOfDay, label: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` };
}

/** 0 at day, up to ~0.55 late at night */
export function darkness(minuteOfDay: number) {
	if (minuteOfDay < 18 * 60) return 0;
	return Math.min(0.55, ((minuteOfDay - 18 * 60) / (8 * 60)) * 0.55);
}

export function currentEnergy(p: TPlayerState, now: number) {
	const regen = Math.floor((now - p.lastEnergyAt) / ENERGY_REGEN_MS);
	return Math.min(MAX_ENERGY, p.energy + Math.max(0, regen));
}

function spendEnergy(p: TPlayerState, now: number, cost: number) {
	p.energy = currentEnergy(p, now) - cost;
	p.lastEnergyAt = now;
}

export const canBuild = (inst: TInstance, userId: string) => inst.kind === "land" && inst.ownerId === userId;

/** Terrain after removed trees/rocks are taken into account. Non-finite coordinates are blocked. */
export function terrainAt(inst: TInstance, x: number, y: number, now: number): number {
	if (!Number.isFinite(x) || !Number.isFinite(y)) return inst.kind === "world" ? T.water : T.fence;
	x = Math.floor(x);
	y = Math.floor(y);
	const base = inst.kind === "world" ? worldTerrain(x, y) : landTerrain(inst.seed, inst.unlocked, x, y);
	if (base !== T.tree && base !== T.rock) return base;
	const tile = inst.tiles.get(tileKey(x, y));
	if (!tile) return base;
	if (inst.kind === "world") return tile.regrowAt !== undefined && now < tile.regrowAt ? T.grass : base;
	if (tile.clearedDay === undefined) return base;
	const respawn = base === T.tree ? TREE_RESPAWN_DAYS : ROCK_RESPAWN_DAYS;
	return clock(inst.epoch, now).day < tile.clearedDay + respawn ? T.grass : base;
}

export function cropStage(tile: TTileState, day: number) {
	if (!tile.cropId || tile.plantedDay === undefined) return null;
	const crop = CROPS[tile.cropId];
	if (!crop) return null;
	// A day counts toward growth once it is over and the crop was watered on it
	const grown = new Set(tile.wateredDays.filter((d) => d >= tile.plantedDay! && d < day)).size;
	return { crop, grown, ready: grown >= crop.growDays, wateredToday: tile.wateredDays.includes(day) };
}

function playerAt(inst: TInstance, x: number, y: number, exceptId?: string) {
	for (const p of inst.players.values())
		if (Math.floor(p.x) === x && Math.floor(p.y) === y && p.userId !== exceptId) return p;
	return undefined;
}

// True when a player box centred at (x, y) touches only walkable tiles
function boxFits(inst: TInstance, x: number, y: number, now: number) {
	if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
	const h = PLAYER_BOX / 2;
	for (let ty = Math.floor(y - h + EPS); ty <= Math.floor(y + h - EPS); ty++)
		for (let tx = Math.floor(x - h + EPS); tx <= Math.floor(x + h - EPS); tx++)
			if (!isWalkableTerrain(terrainAt(inst, tx, ty, now))) return false;
	return true;
}

/** Adds a player at `at` when it is walkable, else at the instance spawn tile centre */
export function enter(
	inst: TInstance,
	base: Omit<TPlayerState, "x" | "y" | "facing">,
	at?: { x: number; y: number; facing: TDir },
): TPlayerState {
	// Checked as if every cleared tree and rock had grown back, so no one enters inside one
	const now = Number.MAX_SAFE_INTEGER;
	const spawn = inst.kind === "world" ? TOWN_SPAWN : LAND_SPAWN;
	const p: TPlayerState =
		at && boxFits(inst, at.x, at.y, now)
			? { ...base, x: at.x, y: at.y, facing: at.facing }
			: { ...base, x: spawn.x + 0.5, y: spawn.y + 0.5, facing: "d" };
	inst.players.set(p.userId, p);
	return p;
}

// Moves one axis by d (|d| ≤ MAX_STEP). When blocked, stops flush against the tile edge.
function moveAxis(inst: TInstance, p: TPlayerState, axis: "x" | "y", d: number, now: number) {
	if (d === 0) return;
	const h = PLAYER_BOX / 2;
	const next = p[axis] + d;
	const fits = (v: number) => (axis === "x" ? boxFits(inst, v, p.y, now) : boxFits(inst, p.x, v, now));
	if (fits(next)) {
		p[axis] = next;
		return;
	}
	const flush = d > 0 ? Math.floor(next + h - EPS) - h : Math.floor(next - h + EPS) + 1 + h;
	if ((d > 0 ? flush > p[axis] : flush < p[axis]) && fits(flush)) p[axis] = flush;
}

/** Moves a player by held direction for dtMs. Players pass through each other. */
export function simulate(inst: TInstance, userId: string, dx: -1 | 0 | 1, dy: -1 | 0 | 1, dtMs: number, now: number): void {
	const p = inst.players.get(userId);
	if (!p || (dx === 0 && dy === 0) || !(dtMs > 0) || !Number.isFinite(dtMs)) return;
	// Facing follows the dominant axis; on a diagonal keep the current facing if it is one of the two
	const h: TDir = dx > 0 ? "r" : "l";
	const v: TDir = dy > 0 ? "d" : "u";
	if (dy === 0) p.facing = h;
	else if (dx === 0) p.facing = v;
	else if (p.facing !== h && p.facing !== v) p.facing = h;

	const dist = (WALK_SPEED * dtMs) / 1000;
	const len = Math.hypot(dx, dy);
	const steps = Math.ceil(dist / MAX_STEP);
	const sx = ((dx / len) * dist) / steps;
	const sy = ((dy / len) * dist) / steps;
	for (let i = 0; i < steps; i++) {
		moveAxis(inst, p, "x", sx, now);
		moveAxis(inst, p, "y", sy, now);
	}
}

/** Tile containing the point REACH tiles ahead of the player centre */
export function facedTile(p: TPlayerState) {
	const [dx, dy] = DIRS[p.facing];
	return { x: Math.floor(p.x + dx * REACH), y: Math.floor(p.y + dy * REACH) };
}

// Deterministic ore roll so the result does not depend on who processes the action
function oreRoll(x: number, y: number, day: number) {
	const h = Math.abs(Math.imul(x * 73856093 ^ y * 19349663 ^ day * 83492791, 0x9e3779b1)) % 100;
	if (h < 3) return "gold";
	if (h < 12) return "iron";
	if (h < 30) return "copper";
	return "stone";
}

const READ_ONLY = "You can only build on your own land.";
const NOT_YOURS = "This isn't your land.";

/**
 * Context action on the faced tile with the equipped item. `inventory` is a read-only snapshot.
 * `animals` are checked first: one whose centre is within HIT_RADIUS of the faced point is hit.
 */
export function use(
	inst: TInstance,
	userId: string,
	now: number,
	inventory: Record<string, number>,
	animals?: { id: number; x: number; y: number }[],
): TActionResult {
	const p = inst.players.get(userId);
	if (!p) return { ok: false, msg: "You are not here." };
	const { x, y } = facedTile(p);
	const { day } = clock(inst.epoch, now);
	const terrain = terrainAt(inst, x, y, now);
	const key = tileKey(x, y);
	const tile = inst.tiles.get(key);
	const energy = currentEnergy(p, now);
	const world = inst.kind === "world";
	const owner = canBuild(inst, userId);
	const tool = p.equipped;
	const item = ITEMS[tool];

	const needEnergy = (cost: number, r: TActionResult): TActionResult =>
		energy < cost
			? { ok: false, msg: "😴 You are too tired. Sleep or wait to regain energy." }
			: { ...r, energyCost: cost, apply: () => (spendEnergy(p, now, cost), r.apply?.()) };

	if (animals?.length) {
		const [dx, dy] = DIRS[p.facing];
		const fx = p.x + dx * REACH;
		const fy = p.y + dy * REACH;
		let hit: number | undefined;
		let best = HIT_RADIUS;
		for (const a of animals) {
			const d = Math.hypot(a.x - fx, a.y - fy);
			if (d <= best) {
				best = d;
				hit = a.id;
			}
		}
		if (hit !== undefined) return needEnergy(2, { ok: true, msg: "", hitAnimalId: hit });
	}

	const other = playerAt(inst, x, y, userId);
	if (other) return { ok: true, msg: `👋 You wave at ${other.name}.` };
	if (terrain === T.portal)
		return world ? { ok: true, msg: "🌀 Heading home.", travel: "land" } : { ok: true, msg: "🌀 Off to the valley.", travel: "world" };
	if (terrain === T.door) return { ok: true, msg: "🏪 Welcome to the General Store!", menu: "shop" };

	// Public fields: anyone can harvest; the field regrows after a few minutes
	if (world && terrain === T.field) {
		const crop = CROPS[fieldCrop(x, y) ?? ""];
		if (crop) {
			if (tile?.regrowAt !== undefined && now < tile.regrowAt) return { ok: false, msg: "This is still growing." };
			return {
				ok: true,
				msg: `🧺 Harvested ${crop.yieldQty} ${ITEMS[crop.yieldItem]?.name}!`,
				give: { [crop.yieldItem]: crop.yieldQty },
				changedTiles: [key],
				apply: () => inst.tiles.set(key, { tilled: true, wateredDays: [], regrowAt: now + CROP_REGROW_MS }),
			};
		}
	}

	// Harvest works with anything in hand
	const stage = !world && tile ? cropStage(tile, day) : null;
	if (stage?.ready) {
		if (!owner) return { ok: false, msg: NOT_YOURS };
		return {
			ok: true,
			msg: `🧺 Harvested ${stage.crop.yieldQty} ${ITEMS[stage.crop.yieldItem]?.name}!`,
			give: { [stage.crop.yieldItem]: stage.crop.yieldQty },
			changedTiles: [key],
			apply: () => inst.tiles.set(key, { tilled: true, wateredDays: [] }),
		};
	}

	if (tool === "hoe" && terrain === T.grass && !tile?.tilled) {
		if (world) return { ok: false, msg: READ_ONLY };
		if (!owner) return { ok: false, msg: NOT_YOURS };
		return needEnergy(2, {
			ok: true,
			msg: "You till the soil.",
			changedTiles: [key],
			apply: () => inst.tiles.set(key, { tilled: true, wateredDays: [] }),
		});
	}
	if (tool === "watering_can") {
		if (terrain === T.water) return { ok: true, msg: "💧 You refill your watering can." };
		if (world) return { ok: false, msg: READ_ONLY };
		if (tile?.tilled) {
			if (!owner) return { ok: false, msg: NOT_YOURS };
			if (tile.wateredDays.includes(day)) return { ok: false, msg: "Already watered today." };
			return needEnergy(1, {
				ok: true,
				msg: "💧 Watered.",
				changedTiles: [key],
				apply: () => tile.wateredDays.push(day),
			});
		}
	}
	if (item?.category === "seed" && item.cropId) {
		if (world) return { ok: false, msg: READ_ONLY };
		if (!tile?.tilled) return { ok: false, msg: "Seeds need tilled soil." };
		if (tile.cropId) return { ok: false, msg: "Something is already growing here." };
		if (!owner) return { ok: false, msg: NOT_YOURS };
		if ((inventory[tool] ?? 0) < 1) return { ok: false, msg: `You have no ${item.name}.` };
		const cropId = item.cropId;
		return {
			ok: true,
			msg: `🌱 Planted ${item.name}. Water it every day!`,
			take: { [tool]: 1 },
			changedTiles: [key],
			apply: () => {
				tile.cropId = cropId;
				tile.plantedDay = day;
				tile.wateredDays = [];
			},
		};
	}
	// Trees and rocks: day-based respawn on private land, minutes in a public lobby
	const clear = (regrowMs: number) => () =>
		inst.tiles.set(key, world ? { wateredDays: [], regrowAt: now + regrowMs } : { wateredDays: [], clearedDay: day });
	if (tool === "axe" && terrain === T.tree) {
		if (!world && !owner) return { ok: false, msg: NOT_YOURS };
		return needEnergy(4, {
			ok: true,
			msg: "🪓 Timber! +3 Wood",
			give: { wood: 3 },
			changedTiles: [key],
			apply: clear(TREE_REGROW_MS),
		});
	}
	if (tool === "pickaxe" && terrain === T.rock) {
		if (!world && !owner) return { ok: false, msg: NOT_YOURS };
		const ore = oreRoll(x, y, day);
		const qty = ore === "stone" ? 2 : 1;
		return needEnergy(4, {
			ok: true,
			msg: `⚒️ +${qty} ${ITEMS[ore]?.name}`,
			give: { [ore]: qty },
			changedTiles: [key],
			apply: clear(ROCK_REGROW_MS),
		});
	}
	return { ok: false, msg: "Nothing to do here." };
}

/** Restores energy when facing your house door after 18:00 */
export function sleep(inst: TInstance, userId: string, now: number): TActionResult {
	const p = inst.players.get(userId);
	if (!p) return { ok: false, msg: "You are not here." };
	const door = facedTile(p);
	if (inst.kind !== "land" || door.x !== HOUSE_DOOR.x || door.y !== HOUSE_DOOR.y)
		return { ok: false, msg: "Face your house door to sleep." };
	const { minuteOfDay } = clock(inst.epoch, now);
	if (minuteOfDay < 18 * 60) return { ok: false, msg: "It's too early to sleep. Come back after 18:00." };
	return {
		ok: true,
		msg: "💤 You feel rested. Energy restored!",
		apply: () => {
			p.energy = MAX_ENERGY;
			p.lastEnergyAt = now;
		},
	};
}
