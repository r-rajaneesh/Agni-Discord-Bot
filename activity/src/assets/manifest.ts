// Which atlas frame draws each game concept. The atlases are built by scripts/build-atlas.ts from art/.
import { CROPS } from "@game/data/crops";
import { ITEMS } from "@game/data/items";
import { ANIMALS } from "@game/entities";
import { T } from "@game/map";
import type { TDir } from "@game/protocol";

export const SRC_TILE = 128; // atlas pixels per tile (rasterised from SVG)
export const DRAW_SCALE = 0.375; // 48 screen px per tile, same as before
export const TILE = SRC_TILE * DRAW_SCALE;

export type TAtlas = "tiles" | "characters" | "animals" | "items" | "ui";
export const ATLASES: TAtlas[] = ["tiles", "characters", "animals", "items", "ui"];
export interface TFrameRef {
	atlas: TAtlas;
	frame: string;
}

const DIRS: TDir[] = ["u", "d", "l", "r"];
const ref = (atlas: TAtlas, frame: string): TFrameRef => ({ atlas, frame });
const tile = (frame: string) => ref("tiles", frame);
const series = (atlas: TAtlas, prefix: string, n: number) => Array.from({ length: n }, (_, i) => ref(atlas, `${prefix}_${i}`));
const perDir = (atlas: TAtlas, prefix: string, n: number) => Object.fromEntries(DIRS.map((d) => [d, series(atlas, `${prefix}_${d}`, n)])) as Record<TDir, TFrameRef[]>;

/** Water shimmer: frames and how long each shows */
export const WATER_FRAMES = series("tiles", "water", 3);
export const WATER_FRAME_MS = 450;

/** Single tiles and overlays the renderer picks by name */
export const TILES = {
	tilled: tile("tilled"),
	watered: tile("watered"),
	dim: tile("dim"),
	fenceH: tile("fence_h"),
	fenceV: tile("fence_v"),
	roof: tile("roof"),
	roofRidge: tile("roof_ridge"),
	houseDoor: tile("house_door"),
	houseRoof: { l: tile("house_roof_l"), m: tile("house_roof_m"), r: tile("house_roof_r") },
	houseWall: { l: tile("house_wall_l"), m: tile("house_wall_m"), r: tile("house_wall_r") },
	houseBase: { l: tile("house_base_l"), m: tile("house_base_m"), r: tile("house_base_r") },
};

/** A public field of each crop: tilled rows with ripe plants */
export const FIELD_FRAMES: Record<string, TFrameRef> = Object.fromEntries(Object.keys(CROPS).map((id) => [id, tile(`field_${id}`)]));

// Every T value → its variants. Buildings and fences have several parts; the renderer picks the part by neighbours.
export const TERRAIN_FRAMES: Record<number, TFrameRef[]> = {
	[T.grass]: series("tiles", "grass", 4),
	[T.path]: series("tiles", "path", 2),
	[T.water]: WATER_FRAMES,
	[T.tree]: series("tiles", "tree", 2),
	[T.rock]: series("tiles", "rock", 2),
	[T.farmland]: [tile("farmland")],
	[T.wall]: [tile("wall")],
	[T.door]: [tile("door")],
	[T.bridge]: [tile("bridge")],
	[T.flowers]: series("tiles", "flowers", 2),
	[T.roof]: [TILES.roof, TILES.roofRidge],
	[T.portal]: [tile("portal")],
	[T.fence]: [TILES.fenceH, TILES.fenceV],
	[T.house]: [...Object.values(TILES.houseRoof), ...Object.values(TILES.houseWall), ...Object.values(TILES.houseBase), TILES.houseDoor],
	[T.field]: Object.values(FIELD_FRAMES),
};

/** Per crop: one frame per growth stage, ending in the ripe frame (growDays + 1 in all) */
export const CROP_FRAMES: Record<string, TFrameRef[]> = Object.fromEntries(Object.values(CROPS).map((c) => [c.id, series("tiles", `crop_${c.id}`, c.growDays + 1)]));

export const ITEM_FRAMES: Record<string, TFrameRef> = Object.fromEntries(Object.keys(ITEMS).map((id) => [id, ref("items", id)]));

/** Per animal kind and facing: standing, then two mid-step frames */
export const ANIMAL_FRAMES: Record<string, Record<TDir, TFrameRef[]>> = Object.fromEntries(Object.keys(ANIMALS).map((k) => [k, perDir("animals", k, 3)]));

/** The player body (shirt in greys, tinted by the player's colour): standing, then two mid-step frames */
export const CHARACTER_FRAMES: Record<TDir, TFrameRef[]> = perDir("characters", "body", 3);
/** Drawn over the body untinted: head, hair, hands, legs */
export const CHARACTER_DETAIL_FRAMES: Record<TDir, TFrameRef[]> = perDir("characters", "detail", 3);
export const CROWN_FRAME = ref("ui", "crown");
export const SHADOW_FRAME = ref("ui", "shadow");

/** A stable hash of a tile position, for picking variants */
export function tileHash(x: number, y: number): number {
	let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
	return (h ^ (h >>> 13)) >>> 0;
}

/** The variant of terrain t drawn at (x, y); the same every time */
export function frameFor(t: number, x: number, y: number): TFrameRef {
	const v = TERRAIN_FRAMES[t] ?? TERRAIN_FRAMES[T.grass]!;
	return v[tileHash(x, y) % v.length]!;
}
