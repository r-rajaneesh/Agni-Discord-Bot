import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CROPS } from "@game/data/crops";
import { ITEMS } from "@game/data/items";
import { ANIMALS } from "@game/entities";
import { T } from "@game/map";
import {
	ANIMAL_FRAMES,
	ATLASES,
	CHARACTER_DETAIL_FRAMES,
	CHARACTER_FRAMES,
	CROP_FRAMES,
	CROWN_FRAME,
	FIELD_FRAMES,
	ITEM_FRAMES,
	SHORE_CORNERS,
	SHORE_FRAMES,
	SHADOW_FRAME,
	SRC_TILE,
	TERRAIN_FRAMES,
	TILES,
	WATER_FRAMES,
	frameFor,
	type TFrameRef,
} from "./manifest";

const DIRS = ["u", "d", "l", "r"] as const;
const ASSETS = join(import.meta.dir, "..", "..", "public", "assets");
type TAtlasJson = { frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>; meta: { image: string; size: { w: number; h: number } } };
const atlas = (name: string) => JSON.parse(readFileSync(join(ASSETS, `${name}.json`), "utf8")) as TAtlasJson;

test("every terrain value has a frame", () => {
	for (const v of Object.values(T)) expect(TERRAIN_FRAMES[v]?.length ?? 0).toBeGreaterThan(0);
});

test("every item has an icon", () => {
	for (const id of Object.keys(ITEMS)) expect(ITEM_FRAMES[id]).toEqual({ atlas: "items", frame: id });
});

test("every crop has a frame per growth stage plus ripe", () => {
	for (const c of Object.values(CROPS)) {
		expect(CROP_FRAMES[c.id]).toHaveLength(c.growDays + 1);
		expect(FIELD_FRAMES[c.id]).toBeDefined();
	}
});

test("every animal kind has walk frames for all four facings", () => {
	for (const kind of Object.keys(ANIMALS)) for (const d of DIRS) expect(ANIMAL_FRAMES[kind]![d].length).toBeGreaterThanOrEqual(2);
	for (const d of DIRS) {
		expect(CHARACTER_FRAMES[d].length).toBeGreaterThanOrEqual(2);
		expect(CHARACTER_DETAIL_FRAMES[d]).toHaveLength(CHARACTER_FRAMES[d].length);
	}
});

describe("frameFor", () => {
	test("is deterministic", () => {
		for (const [x, y] of [[0, 0], [5, -3], [-40, 17], [1000, -1000]] as const) expect(frameFor(T.grass, x, y)).toEqual(frameFor(T.grass, x, y));
	});

	test("spreads grass over its variants, also at negative coordinates", () => {
		const seen = new Set<string>();
		for (let x = -8; x < 8; x++) for (let y = -8; y < 8; y++) seen.add(frameFor(T.grass, x, y).frame);
		expect(seen.size).toBe(TERRAIN_FRAMES[T.grass]!.length);
	});
});

describe("atlases", () => {
	const refs: TFrameRef[] = [
		...Object.values(TERRAIN_FRAMES).flat(),
		...Object.values(CROP_FRAMES).flat(),
		...Object.values(FIELD_FRAMES),
		...Object.values(ITEM_FRAMES),
		...Object.values(ANIMAL_FRAMES).flatMap((f) => Object.values(f).flat()),
		...Object.values(CHARACTER_FRAMES).flat(),
		...Object.values(CHARACTER_DETAIL_FRAMES).flat(),
		...WATER_FRAMES,
		...Object.values(SHORE_FRAMES),
		...Object.values(SHORE_CORNERS),
		...Object.values(TILES).flatMap((v) => ("atlas" in v ? [v] : Object.values(v))),
		CROWN_FRAME,
		SHADOW_FRAME,
	];

	test("every referenced frame exists in its atlas json", () => {
		const missing = refs.filter((r) => !atlas(r.atlas).frames[r.frame]).map((r) => `${r.atlas}/${r.frame}`);
		expect(missing).toEqual([]);
	});

	test("tiles, characters, animals and items are SRC_TILE square", () => {
		for (const r of refs) {
			if (r.atlas === "ui") continue;
			const f = atlas(r.atlas).frames[r.frame]!.frame;
			expect([r.frame, f.w, f.h]).toEqual([r.frame, SRC_TILE, SRC_TILE]);
		}
	});

	test("water has a bank for every combination of land sides", () => {
		for (let m = 1; m < 16; m++) expect(SHORE_FRAMES[m]).toEqual({ atlas: "tiles", frame: `shore_${m}` });
	});

	test("the DOM's item rects match the items atlas", () => {
		const rects = JSON.parse(readFileSync(join(import.meta.dir, "items.frames.json"), "utf8")) as { size: unknown; frames: Record<string, unknown> };
		const items = atlas("items");
		expect(rects.size).toEqual(items.meta.size);
		for (const [name, f] of Object.entries(items.frames)) expect(rects.frames[name]).toEqual(f.frame);
	});

	test("every sheet is a power of two each way, so it gets mipmaps", () => {
		const pot = (n: number) => n > 0 && (n & (n - 1)) === 0;
		for (const name of ATLASES) {
			const { meta } = atlas(name);
			expect(meta.image).toBe(`${name}.png`);
			expect(pot(meta.size.w) && pot(meta.size.h)).toBe(true);
		}
	});
});
