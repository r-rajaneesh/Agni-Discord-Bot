// Loads the atlases, makes the walk animations, and says which tile frames make up each tile
import type Phaser from "phaser";
import { CHUNK, chunkKey, chunkOf, landBaseTerrain } from "@game/chunks";
import { HOUSE_DOOR, clock, cropStage, terrainAt, tileKey, type TInstance } from "@game/engine";
import { T } from "@game/map";
import type { TDir } from "@game/protocol";
import { fieldCrop } from "@game/world";
import { ANIMAL_FRAMES, ATLASES, CHARACTER_DETAIL_FRAMES, CHARACTER_FRAMES, CROP_FRAMES, FIELD_FRAMES, TILES, WATER_FRAMES, WATER_FRAME_MS, frameFor, tileHash, type TFrameRef } from "./assets/manifest";

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
const water = (x: number, y: number, now: number) => WATER_FRAMES[(waterStep(now) + tileHash(x, y)) % WATER_FRAMES.length]!.frame;

const mod = (n: number, m: number) => ((n % m) + m) % m;
// Ground that fills the whole tile; the rest are drawn over grass
const GROUND = new Set<number>([T.path, T.farmland, T.wall, T.door, T.bridge, T.flowers]);
const OVERLAY = new Set<number>([T.tree, T.rock, T.portal]);

function ground(t: number, x: number, y: number, now: number): string {
	if (t === T.water) return water(x, y, now);
	return frameFor(GROUND.has(t) ? t : T.grass, x, y).frame;
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
		const out = [ground(base, x, y, now)];
		if (OVERLAY.has(base)) out.push(frameFor(base, x, y).frame);
		out.push(TILES.dim.frame);
		const lx = mod(x, CHUNK);
		const ly = mod(y, CHUNK);
		const open = (dx: number, dy: number) => inst.unlocked.has(chunkKey(cx + dx, cy + dy));
		if ((lx === 0 && open(-1, 0)) || (lx === CHUNK - 1 && open(1, 0))) out.push(fence(true));
		else if ((ly === 0 && open(0, -1)) || (ly === CHUNK - 1 && open(0, 1))) out.push(fence(false));
		return out;
	}
	const terrain = terrainAt(inst, x, y, now);
	const tile = inst.tiles.get(tileKey(x, y));
	if (terrain === T.house) return [house(inst, x, y, now)];
	if (terrain === T.roof) return [(terrainAt(inst, x, y - 1, now) === T.roof ? TILES.roof : TILES.roofRidge).frame];
	if (terrain === T.field) {
		if (tile?.regrowAt !== undefined && now < tile.regrowAt) return [TILES.tilled.frame];
		return [FIELD_FRAMES[fieldCrop(x, y) ?? "wheat"]!.frame];
	}
	const out = [ground(terrain, x, y, now)];
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

/** True when a tile shows water, so its chunk is redrawn as the shimmer moves on */
export const hasWater = (layers: string[]) => layers.some((l) => l.startsWith("water_"));
