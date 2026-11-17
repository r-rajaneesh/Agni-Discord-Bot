// Writes the original vector art (scripts/art/*) to art/<atlas>/<frame>.svg.
// Run: bun scripts/draw-art.ts, then bun scripts/build-atlas.ts
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CROPS } from "../game/data/crops";
import { ITEMS } from "../game/data/items";
import { ANIMALS, ANIMAL_FRAMES, animal } from "./art/animals";
import { CHARACTER_FRAMES, character, crown, playerShadow } from "./art/characters";
import { cropStage, field } from "./art/crops";
import { itemIcon } from "./art/items";
import * as t from "./art/terrain";

const ROOT = join(import.meta.dir, "..", "art");
const DIRS = ["u", "d", "l", "r"] as const;
export const WATER_FRAMES = 3;

const out: Record<string, Record<string, string>> = { tiles: {}, characters: {}, animals: {}, items: {}, ui: {} };
const tiles = out.tiles!;

for (let i = 0; i < 4; i++) tiles[`grass_${i}`] = t.grass(i).svg();
for (let i = 0; i < 2; i++) tiles[`path_${i}`] = t.pathTile(i).svg();
for (let i = 0; i < WATER_FRAMES; i++) tiles[`water_${i}`] = t.water(i, WATER_FRAMES).svg();
for (let i = 0; i < 2; i++) tiles[`flowers_${i}`] = t.flowers(i).svg();
for (let i = 0; i < 2; i++) tiles[`tree_${i}`] = t.tree(i).svg();
for (let i = 0; i < 2; i++) tiles[`rock_${i}`] = t.rock(i).svg();
Object.assign(tiles, {
	farmland: t.farmland().svg(),
	tilled: t.tilled().svg(),
	watered: t.watered().svg(),
	wall: t.wall().svg(),
	roof: t.roof().svg(),
	roof_ridge: t.roofRidge().svg(),
	door: t.shopDoor().svg(),
	bridge: t.bridge().svg(),
	portal: t.portal().svg(),
	fence_h: t.fence("h").svg(),
	fence_v: t.fence("v").svg(),
	house_door: t.houseDoor().svg(),
	dim: t.dim().svg(),
});
for (const e of ["l", "m", "r"] as const) {
	tiles[`house_roof_${e}`] = t.houseRoof(e).svg();
	tiles[`house_wall_${e}`] = t.houseWall(e).svg();
	tiles[`house_base_${e}`] = t.houseBase(e).svg();
}
for (const crop of Object.values(CROPS)) {
	tiles[`field_${crop.id}`] = field(crop.id).svg();
	for (let s = 0; s <= crop.growDays; s++) tiles[`crop_${crop.id}_${s}`] = cropStage(crop.id, s).svg();
}

for (const d of DIRS)
	for (let i = 0; i < CHARACTER_FRAMES; i++) {
		out.characters![`body_${d}_${i}`] = character(d, i, "body");
		out.characters![`detail_${d}_${i}`] = character(d, i, "detail");
	}
for (const kind of Object.keys(ANIMALS)) for (const d of DIRS) for (let i = 0; i < ANIMAL_FRAMES; i++) out.animals![`${kind}_${d}_${i}`] = animal(kind, d, i);
for (const id of Object.keys(ITEMS)) out.items![id] = itemIcon(id);
out.ui!.crown = crown();
out.ui!.shadow = playerShadow();

for (const [atlas, frames] of Object.entries(out)) {
	const dir = join(ROOT, atlas);
	mkdirSync(dir, { recursive: true });
	for (const f of readdirSync(dir)) if (f.endsWith(".svg")) rmSync(join(dir, f));
	for (const [name, svg] of Object.entries(frames)) writeFileSync(join(dir, `${name}.svg`), svg);
	console.log(`${atlas}: ${Object.keys(frames).length} frames`);
}
