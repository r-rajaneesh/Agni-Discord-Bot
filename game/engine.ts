// Pure game rules. No Discord or Mongo imports, so everything here is unit-testable.
import { CROPS } from "./data/crops";
import { ITEMS } from "./data/items";
import { MAP_H, MAP_W, PLOTS, SPAWN, T, baseTerrain, isWalkableTerrain, plotAt } from "./map";

/** One in-game day (06:00 → 02:00) lasts 20 real minutes; one game minute = one real second. */
export const DAY_MS = 20 * 60 * 1000;
export const MAX_ENERGY = 100;
export const ENERGY_REGEN_MS = 20_000;
const TREE_RESPAWN_DAYS = 3;
const ROCK_RESPAWN_DAYS = 2;

export type TDir = "u" | "d" | "l" | "r";
export const DIRS: Record<TDir, [number, number]> = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };

export interface TTileState {
	tilled?: boolean;
	cropId?: string;
	plantedDay?: number;
	wateredDays: number[];
	/** Day a tree/rock was removed; it grows back after its respawn time */
	clearedDay?: number;
}

export interface TPlayerState {
	userId: string;
	name: string;
	x: number;
	y: number;
	facing: TDir;
	energy: number;
	lastEnergyAt: number;
	equipped: string;
	plotId: number | null;
	colour: string;
	/** Farm Pass holder (cosmetic crown); refreshed on /farm play */
	premium?: boolean;
}

export interface TWorldState {
	guildId: string;
	epoch: number;
	plotOwners: (string | null)[];
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
	/** Tile keys whose state apply() changes (for persistence) */
	changedTiles?: string[];
	apply?: () => void;
}

export const tileKey = (x: number, y: number) => `${x},${y}`;

export function createWorld(guildId: string, now: number): TWorldState {
	return { guildId, epoch: now, plotOwners: PLOTS.map(() => null), tiles: new Map(), players: new Map() };
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

/** Terrain after removed trees/rocks are taken into account */
export function terrainAt(world: TWorldState, x: number, y: number, day: number) {
	const base = baseTerrain(x, y);
	if (base !== T.tree && base !== T.rock) return base;
	const cleared = world.tiles.get(tileKey(x, y))?.clearedDay;
	if (cleared === undefined) return base;
	const respawn = base === T.tree ? TREE_RESPAWN_DAYS : ROCK_RESPAWN_DAYS;
	return day < cleared + respawn ? T.grass : base;
}

export function cropStage(tile: TTileState, day: number) {
	if (!tile.cropId || tile.plantedDay === undefined) return null;
	const crop = CROPS[tile.cropId];
	if (!crop) return null;
	// A day counts toward growth once it is over and the crop was watered on it
	const grown = new Set(tile.wateredDays.filter((d) => d >= tile.plantedDay! && d < day)).size;
	return { crop, grown, ready: grown >= crop.growDays, wateredToday: tile.wateredDays.includes(day) };
}

export function playerAt(world: TWorldState, x: number, y: number, exceptId?: string) {
	for (const p of world.players.values()) if (p.x === x && p.y === y && p.userId !== exceptId) return p;
	return undefined;
}

const PALETTE = ["#e74c3c", "#3498db", "#9b59b6", "#e67e22", "#1abc9c", "#f1c40f", "#e84393", "#2ecc71"];

export function joinWorld(world: TWorldState, userId: string, name: string, now: number) {
	let p = world.players.get(userId);
	if (!p) {
		p = {
			userId,
			name,
			x: SPAWN.x,
			y: SPAWN.y,
			facing: "d",
			energy: MAX_ENERGY,
			lastEnergyAt: now,
			equipped: "hoe",
			plotId: null,
			colour: PALETTE[world.players.size % PALETTE.length] as string,
		};
		world.players.set(userId, p);
	}
	p.name = name;
	if (p.plotId === null) {
		const free = world.plotOwners.findIndex((o) => o === null);
		if (free !== -1) {
			world.plotOwners[free] = userId;
			p.plotId = free;
		}
	}
	return p;
}

export function move(world: TWorldState, userId: string, dir: TDir, now: number): TActionResult {
	const p = world.players.get(userId);
	if (!p) return { ok: false, msg: "You are not in this world." };
	// Pressing any direction other than the one faced only turns the player; the next press moves
	if (p.facing !== dir) {
		p.facing = dir;
		return { ok: true, msg: "" };
	}
	p.facing = dir;
	const [dx, dy] = DIRS[dir];
	const nx = p.x + dx;
	const ny = p.y + dy;
	const { day } = clock(world.epoch, now);
	if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H || !isWalkableTerrain(terrainAt(world, nx, ny, day)))
		return { ok: false, msg: "Something is in the way." };
	const other = playerAt(world, nx, ny, userId);
	if (other) return { ok: false, msg: `${other.name} is standing there.` };
	p.x = nx;
	p.y = ny;
	return { ok: true, msg: "" };
}

export function facedTile(p: TPlayerState) {
	const [dx, dy] = DIRS[p.facing];
	return { x: p.x + dx, y: p.y + dy };
}

// Deterministic ore roll so the result does not depend on who processes the action
function oreRoll(x: number, y: number, day: number) {
	const h = Math.abs(Math.imul(x * 73856093 ^ y * 19349663 ^ day * 83492791, 0x9e3779b1)) % 100;
	if (h < 3) return "gold";
	if (h < 12) return "iron";
	if (h < 30) return "copper";
	return "stone";
}

/** Context action on the faced tile with the equipped item. `inventory` is a read-only snapshot. */
export function use(world: TWorldState, userId: string, now: number, inventory: Record<string, number>): TActionResult {
	const p = world.players.get(userId);
	if (!p) return { ok: false, msg: "You are not in this world." };
	const { x, y } = facedTile(p);
	const { day } = clock(world.epoch, now);
	const terrain = terrainAt(world, x, y, day);
	const key = tileKey(x, y);
	const tile = world.tiles.get(key);
	const energy = currentEnergy(p, now);
	const plot = plotAt(x, y);
	const ownsPlot = plot !== undefined && world.plotOwners[plot.id] === userId;
	const tool = p.equipped;
	const item = ITEMS[tool];

	const other = playerAt(world, x, y, userId);
	if (other) return { ok: true, msg: `👋 You wave at ${other.name}.` };
	if (terrain === T.door) return { ok: true, msg: "🏪 Welcome to the General Store!", menu: "shop" };

	const needEnergy = (cost: number, r: TActionResult): TActionResult =>
		energy < cost
			? { ok: false, msg: "😴 You are too tired. Sleep or wait to regain energy." }
			: { ...r, energyCost: cost, apply: () => (spendEnergy(p, now, cost), r.apply?.()) };

	// Harvest works with anything in hand
	const stage = tile ? cropStage(tile, day) : null;
	if (stage?.ready) {
		if (!ownsPlot) return { ok: false, msg: "This crop belongs to someone else." };
		return {
			ok: true,
			msg: `🧺 Harvested ${stage.crop.yieldQty} ${ITEMS[stage.crop.yieldItem]?.name}!`,
			give: { [stage.crop.yieldItem]: stage.crop.yieldQty },
			changedTiles: [key],
			apply: () => world.tiles.set(key, { tilled: true, wateredDays: [] }),
		};
	}

	if (tool === "hoe" && terrain === T.farmland && !tile?.tilled) {
		if (!ownsPlot) return { ok: false, msg: plot ? "That plot belongs to someone else." : "You can only till your plot." };
		return needEnergy(2, {
			ok: true,
			msg: "You till the soil.",
			changedTiles: [key],
			apply: () => world.tiles.set(key, { tilled: true, wateredDays: [] }),
		});
	}
	if (tool === "watering_can") {
		if (terrain === T.water) return { ok: true, msg: "💧 You refill your watering can." };
		if (tile?.tilled) {
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
		if (!tile?.tilled) return { ok: false, msg: "Seeds need tilled soil." };
		if (tile.cropId) return { ok: false, msg: "Something is already growing here." };
		if (!ownsPlot) return { ok: false, msg: "You can only plant on your plot." };
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
	if (tool === "axe" && terrain === T.tree) {
		if (x <= 0 || y <= 0 || x >= MAP_W - 1 || y >= MAP_H - 1) return { ok: false, msg: "This old tree is too sturdy." };
		return needEnergy(4, {
			ok: true,
			msg: "🪓 Timber! +3 Wood",
			give: { wood: 3 },
			changedTiles: [key],
			apply: () => world.tiles.set(key, { wateredDays: [], clearedDay: day }),
		});
	}
	if (tool === "pickaxe" && terrain === T.rock) {
		if (x >= MAP_W - 1) return { ok: false, msg: "This boulder will not budge." };
		const ore = oreRoll(x, y, day);
		const qty = ore === "stone" ? 2 : 1;
		return needEnergy(4, {
			ok: true,
			msg: `⚒️ +${qty} ${ITEMS[ore]?.name}`,
			give: { [ore]: qty },
			changedTiles: [key],
			apply: () => world.tiles.set(key, { wateredDays: [], clearedDay: day }),
		});
	}
	return { ok: false, msg: "Nothing to do here." };
}

export function sleep(world: TWorldState, userId: string, now: number): TActionResult {
	const p = world.players.get(userId);
	if (!p) return { ok: false, msg: "You are not in this world." };
	const { minuteOfDay } = clock(world.epoch, now);
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
