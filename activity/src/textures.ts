// Loads the atlases, makes the walk animations, and says which tile frames make up each tile
import type Phaser from "phaser";
import { CHUNK, chunkKey, chunkOf, landBaseTerrain } from "@game/chunks";
import { HOUSE_DOOR, clock, cropStage, terrainAt, tileKey, type TInstance } from "@game/engine";
import { T } from "@game/map";
import type { TDir } from "@game/protocol";
import { fieldCrop } from "@game/world";
import {
	ANIMAL_FRAMES,
	ATLASES,
	CHARACTER_DETAIL_FRAMES,
	CHARACTER_FRAMES,
	CROP_FRAMES,
	FIELD_FRAMES,
	SHORE_FRAMES,
	TILES,
	WATER_FRAMES,
	WATER_FRAME_MS,
	frameFor,
	tileHash,
	type TFrameRef,
} from "./assets/manifest";

/** Queues every atlas; paths are relative so they load from the Activity's own origin */
export function loadAtlases(load: Phaser.Loader.LoaderPlugin): void {
	for (const a of ATLASES) load.atlas(a, `assets/${a}.png`, `assets/${a}.json`);
}

const WALK_FPS = 8;
// Step, stand, other step, stand: frame 0 is standing
const CYCLE = [1, 0, 2, 0];
const walk = (frames: TFrameRef[]) => CYCLE.map((i) => ({ key: frames[i]!.atlas, frame: frames[i]!.frame }));

export const bodyAnim = (d: TDir) => `body-${d}`;
export const detailAnim = (d: TDir) => `detail-${d}`;
export const animalAnim = (kind: string, d: TDir) => `animal-${kind}-${d}`;

/** The 4-direction walk animations for the player layers and every animal kind */
export function createAnims(anims: Phaser.Animations.AnimationManager): void {
	const add = (key: string, frames: TFrameRef[]) => {
		if (!anims.exists(key)) anims.create({ key, frames: walk(frames), frameRate: WALK_FPS, repeat: -1 });
	};
	for (const d of ["u", "d", "l", "r"] as const) {
		add(bodyAnim(d), CHARACTER_FRAMES[d]);
		add(detailAnim(d), CHARACTER_DETAIL_FRAMES[d]);
		for (const [kind, f] of Object.entries(ANIMAL_FRAMES)) add(animalAnim(kind, d), f[d]);
	}
}

/** Which water frame a tile shows at `now`; neighbours are out of step so the river shimmers */
export const waterStep = (now: number) => Math.floor(now / WATER_FRAME_MS);
export const waterFrame = (x: number, y: number, now: number) => WATER_FRAMES[(waterStep(now) + tileHash(x, y)) % WATER_FRAMES.length]!.frame;
const WATER_NAMES = new Set(WATER_FRAMES.map((f) => f.frame));
/** True for the water frames themselves (not the banks drawn over them) */
export const isWaterFrame = (frame: string) => WATER_NAMES.has(frame);

const mod = (n: number, m: number) => ((n % m) + m) % m;
// Ground that fills the whole tile; the rest are drawn over grass
const GROUND = new Set<number>([T.path, T.farmland, T.bridge, T.flowers]);
// A bridge counts as water for banks, so the river runs on under it
const WET = new Set<number>([T.water, T.bridge]);
type TTerrainAt = (x: number, y: number) => number;
const OVERLAY = new Set<number>([T.tree, T.rock, T.portal]);

function ground(t: number, x: number, y: number): string {
	return frameFor(GROUND.has(t) ? t : T.grass, x, y).frame;
}

/** Water, plus a bank on each side that borders land */
function water(at: TTerrainAt, x: number, y: number, now: number): string[] {
	const dry = (dx: number, dy: number) => !WET.has(at(x + dx, y + dy));
	const mask = (dry(0, -1) ? 1 : 0) | (dry(1, 0) ? 2 : 0) | (dry(0, 1) ? 4 : 0) | (dry(-1, 0) ? 8 : 0);
	return mask ? [waterFrame(x, y, now), SHORE_FRAMES[mask]!.frame] : [waterFrame(x, y, now)];
}

// The shop front: posts only at its outer ends, a signboard over the doors, windows on alternate tiles
function shopFront(at: TTerrainAt, x: number, y: number): string {
	const front = (dx: number, dy: number) => {
		const t = at(x + dx, y + dy);
		return t === T.wall || t === T.door;
	};
	if (at(x, y) === T.door) return TILES.shopDoor.frame;
	const end = !front(-1, 0) ? "l" : !front(1, 0) ? "r" : "m";
	if (at(x, y - 1) === T.roof) {
		if (at(x, y + 1) === T.door) return (at(x - 1, y + 1) === T.door ? TILES.shopSign.r : TILES.shopSign.l).frame;
		return (end === "m" && mod(x, 2) === 0 ? TILES.shopUpperWin : TILES.shopUpper[end]).frame;
	}
	return (end === "m" && mod(x, 2) === 0 ? TILES.shopLowerWin : TILES.shopLower[end]).frame;
}

// The house: a roof row, then wall rows, the bottom one on a stone footing with the door; ends are trimmed
function house(inst: TInstance, x: number, y: number, now: number): string {
	const is = (dx: number, dy: number) => terrainAt(inst, x + dx, y + dy, now) === T.house;
	const end = !is(-1, 0) ? "l" : !is(1, 0) ? "r" : "m";
	if (!is(0, -1)) return TILES.houseRoof[end].frame;
	if (x === HOUSE_DOOR.x && y === HOUSE_DOOR.y) return TILES.houseDoor.frame;
	return (is(0, 1) ? TILES.houseWall : TILES.houseBase)[end].frame;
}

function fence(vertical: boolean): string {
	return (vertical ? TILES.fenceV : TILES.fenceH).frame;
}

/** Tile frames (all in the "tiles" atlas) to stamp, bottom to top, for one tile */
export function tileLayers(inst: TInstance, x: number, y: number, now: number): string[] {
	const { cx, cy } = chunkOf(x, y);
	if (inst.kind === "land" && !inst.unlocked.has(chunkKey(cx, cy))) {
		// Locked: the land that is there, dimmed, fenced where it meets open land
		const base = landBaseTerrain(inst.seed, x, y);
		const out = base === T.water ? water((ax, ay) => landBaseTerrain(inst.seed, ax, ay), x, y, now) : [ground(base, x, y)];
		if (OVERLAY.has(base)) out.push(frameFor(base, x, y).frame);
		out.push(TILES.dim.frame);
		const lx = mod(x, CHUNK);
		const ly = mod(y, CHUNK);
		const open = (dx: number, dy: number) => inst.unlocked.has(chunkKey(cx + dx, cy + dy));
		// A corner tile that borders open land on two sides gets both fences
		if ((lx === 0 && open(-1, 0)) || (lx === CHUNK - 1 && open(1, 0))) out.push(fence(true));
		if ((ly === 0 && open(0, -1)) || (ly === CHUNK - 1 && open(0, 1))) out.push(fence(false));
		return out;
	}
	const terrain = terrainAt(inst, x, y, now);
	const tile = inst.tiles.get(tileKey(x, y));
	const at: TTerrainAt = (ax, ay) => terrainAt(inst, ax, ay, now);
	if (terrain === T.house) return [house(inst, x, y, now)];
	if (terrain === T.wall || terrain === T.door) return [shopFront(at, x, y)];
	if (terrain === T.water) return water(at, x, y, now);
	if (terrain === T.roof) return [(terrainAt(inst, x, y - 1, now) === T.roof ? TILES.roof : TILES.roofRidge).frame];
	if (terrain === T.field) {
		if (tile?.regrowAt !== undefined && now < tile.regrowAt) return [TILES.tilled.frame];
		return [FIELD_FRAMES[fieldCrop(x, y) ?? "wheat"]!.frame];
	}
	const out = [ground(terrain, x, y)];
	if (tile?.tilled) {
		const { day } = clock(inst.epoch, now);
		out.push((tile.wateredDays.includes(day) ? TILES.watered : TILES.tilled).frame);
		const stage = cropStage(tile, day);
		const frames = stage && CROP_FRAMES[stage.crop.id];
		if (stage && frames) out.push(frames[Math.min(stage.grown, frames.length - 1)]!.frame);
	}
	if (OVERLAY.has(terrain)) out.push(frameFor(terrain, x, y).frame);
	else if (terrain === T.fence) {
		const f = (dx: number, dy: number) => terrainAt(inst, x + dx, y + dy, now) === T.fence;
		out.push(fence((f(0, -1) || f(0, 1)) && !f(-1, 0) && !f(1, 0)));
	}
	return out;
}

