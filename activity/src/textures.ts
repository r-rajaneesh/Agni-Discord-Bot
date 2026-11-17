// Procedural 16×16 pixel art, ported from the old server renderer, plus which sprites make up each tile
import type Phaser from "phaser";
import { CHUNK, chunkKey, chunkOf, landBaseTerrain } from "@game/chunks";
import { CROPS } from "@game/data/crops";
import { HOUSE_DOOR, clock, cropStage, terrainAt, tileKey, type TDir, type TInstance } from "@game/engine";
import { T } from "@game/map";
import { fieldCrop } from "@game/world";

export const SRC = 16; // sprite pixel size
export const SCALE = 3;
export const TILE = SRC * SCALE; // 48px on screen

type TPx = (x: number, y: number, w: number, h: number, c: string) => void;

function sprite(draw: (px: TPx) => void): HTMLCanvasElement {
	const c = document.createElement("canvas");
	c.width = SRC;
	c.height = SRC;
	const ctx = c.getContext("2d")!;
	draw((x, y, w, h, colour) => {
		ctx.fillStyle = colour;
		ctx.fillRect(x, y, w, h);
	});
	return c;
}

const grassBase = (px: TPx, seed: number) => {
	px(0, 0, 16, 16, "#5fa845");
	for (let i = 0; i < 6; i++) {
		const h = (seed * 31 + i * 17) % 256;
		px(h % 16, (h >> 4) % 16, 1, 2, "#4f9238");
	}
};

const tilledBase = (px: TPx) => {
	px(0, 0, 16, 16, "#6b4a2b");
	for (let y = 2; y < 16; y += 4) px(1, y, 14, 1, "#563a20");
};

const ripe = (colour: string) => (px: TPx) => {
	px(7, 3, 2, 6, "#3c9a3c");
	px(4, 4, 3, 2, "#57c157");
	px(9, 4, 3, 2, "#57c157");
	px(4, 8, 8, 6, colour);
	px(5, 9, 2, 2, "rgba(255,255,255,0.45)");
};

// A public field: tilled soil with two rows of ripe plants
const field = (colour: string) => (px: TPx) => {
	tilledBase(px);
	for (const y of [1, 9])
		for (const x of [1, 6, 11]) {
			px(x + 1, y, 1, 3, "#3c9a3c");
			px(x, y + 1, 1, 1, "#57c157");
			px(x + 2, y + 1, 1, 1, "#57c157");
			px(x, y + 3, 3, 3, colour);
			px(x, y + 3, 1, 1, "rgba(255,255,255,0.45)");
		}
};

const STATIC: Record<string, (px: TPx) => void> = {
	grass0: (px) => grassBase(px, 0),
	grass1: (px) => grassBase(px, 1),
	grass2: (px) => grassBase(px, 2),
	grass3: (px) => grassBase(px, 3),
	path: (px) => {
		px(0, 0, 16, 16, "#c9a86b");
		px(3, 4, 2, 1, "#b8955a");
		px(10, 11, 3, 1, "#b8955a");
		px(12, 2, 1, 1, "#b8955a");
	},
	water: (px) => {
		px(0, 0, 16, 16, "#3b7dd8");
		px(2, 4, 4, 1, "#6aa5ee");
		px(9, 10, 5, 1, "#6aa5ee");
	},
	farmland: (px) => {
		px(0, 0, 16, 16, "#8a6a43");
		px(0, 0, 16, 1, "#7a5c38");
		px(0, 0, 1, 16, "#7a5c38");
	},
	tilled: tilledBase,
	watered: (px) => {
		px(0, 0, 16, 16, "#4b331d");
		for (let y = 2; y < 16; y += 4) px(1, y, 14, 1, "#3a2714");
	},
	wall: (px) => {
		px(0, 0, 16, 16, "#d9c3a0");
		px(0, 7, 16, 1, "#b9a27f");
		px(7, 0, 1, 7, "#b9a27f");
		px(3, 8, 1, 8, "#b9a27f");
		px(11, 8, 1, 8, "#b9a27f");
	},
	roof: (px) => {
		px(0, 0, 16, 16, "#b0413e");
		for (let y = 1; y < 16; y += 3) px(0, y, 16, 1, "#8e2f2d");
	},
	door: (px) => {
		px(0, 0, 16, 16, "#d9c3a0");
		px(3, 2, 10, 14, "#7a4b24");
		px(4, 3, 8, 13, "#8e5a2c");
		px(10, 9, 1, 2, "#f1c40f");
	},
	bridge: (px) => {
		px(0, 0, 16, 16, "#3b7dd8");
		px(0, 1, 16, 14, "#9c7444");
		for (let x = 3; x < 16; x += 4) px(x, 1, 1, 14, "#7d5b33");
	},
	flowers: (px) => {
		px(0, 0, 16, 16, "#5fa845");
		px(3, 3, 2, 2, "#f5e663");
		px(10, 6, 2, 2, "#ef7fb0");
		px(5, 11, 2, 2, "#ffffff");
		px(12, 12, 2, 2, "#f5e663");
	},
	tree: (px) => {
		px(6, 10, 4, 6, "#6b4423");
		px(2, 1, 12, 10, "#2f7a32");
		px(3, 2, 6, 4, "#3f9142");
		px(1, 4, 14, 5, "#2f7a32");
	},
	rock: (px) => {
		px(2, 6, 12, 8, "#8b8f94");
		px(4, 4, 8, 3, "#9aa0a6");
		px(4, 7, 4, 2, "#b3b8bd");
		px(2, 13, 12, 1, "#6d7176");
	},
	seedling: (px) => {
		px(7, 8, 2, 5, "#3c9a3c");
		px(5, 8, 2, 2, "#57c157");
		px(9, 7, 2, 2, "#57c157");
	},
	sprout: (px) => {
		px(7, 4, 2, 10, "#3c9a3c");
		px(4, 6, 3, 3, "#57c157");
		px(9, 5, 3, 3, "#57c157");
		px(4, 10, 3, 2, "#57c157");
		px(9, 9, 3, 2, "#57c157");
	},
	// Glowing stone, drawn over grass
	portal: (px) => {
		px(2, 4, 12, 11, "rgba(122,215,255,0.25)");
		px(4, 2, 8, 2, "rgba(122,215,255,0.25)");
		px(4, 5, 8, 9, "#6f7680");
		px(5, 3, 6, 2, "#828a94");
		px(4, 14, 8, 1, "#50565e");
		px(7, 6, 2, 6, "#7ad7ff");
		px(6, 8, 4, 2, "#7ad7ff");
		px(7, 8, 2, 2, "#e8fbff");
	},
	// Posts and two rails, drawn over grass
	fence: (px) => {
		px(0, 5, 16, 2, "#a0763f");
		px(0, 10, 16, 2, "#a0763f");
		px(0, 7, 16, 1, "#7d5b33");
		px(0, 12, 16, 1, "#7d5b33");
		for (const x of [1, 12]) {
			px(x, 3, 3, 12, "#8a6235");
			px(x, 3, 3, 1, "#b88a4f");
			px(x, 14, 3, 1, "#5e4224");
		}
	},
	house_roof: (px) => {
		px(0, 0, 16, 16, "#6e4b8c");
		for (let y = 2; y < 16; y += 3) px(0, y, 16, 1, "#563a6e");
		px(0, 15, 16, 1, "#3f2a52");
	},
	house_wall: (px) => {
		px(0, 0, 16, 16, "#c79a6b");
		for (let y = 3; y < 16; y += 4) px(0, y, 16, 1, "#a87c50");
		px(4, 5, 8, 6, "#5b3a22");
		px(5, 6, 6, 4, "#9fd3f0");
		px(7, 6, 2, 4, "#5b3a22");
	},
	house_door: (px) => {
		px(0, 0, 16, 16, "#c79a6b");
		for (let y = 3; y < 16; y += 4) px(0, y, 16, 1, "#a87c50");
		px(4, 3, 8, 13, "#5b3a22");
		px(5, 4, 6, 12, "#7a4b24");
		px(9, 10, 1, 2, "#f1c40f");
	},
	dim: (px) => px(0, 0, 16, 16, "rgba(0,0,0,0.5)"),
	crown: (px) => {
		px(4, 13, 8, 2, "#f1c40f");
		px(4, 11, 2, 2, "#f1c40f");
		px(7, 11, 2, 2, "#f1c40f");
		px(10, 11, 2, 2, "#f1c40f");
	},
};

export function registerTextures(textures: Phaser.Textures.TextureManager): void {
	const add = (key: string, draw: (px: TPx) => void) => {
		if (!textures.exists(key)) textures.addCanvas(key, sprite(draw));
	};
	for (const [key, draw] of Object.entries(STATIC)) add(key, draw);
	for (const crop of Object.values(CROPS)) {
		add(`ripe:${crop.id}`, ripe(crop.colour));
		add(`field:${crop.id}`, field(crop.colour));
	}
}

const EYES: Record<TDir, [number, number][]> = { d: [[5, 4], [9, 4]], u: [], l: [[4, 4]], r: [[11, 4]] };

/** Player sprite for a colour and facing, made on first use */
export function playerTexture(textures: Phaser.Textures.TextureManager, colour: string, facing: TDir): string {
	const key = `player:${colour}:${facing}`;
	if (!textures.exists(key))
		textures.addCanvas(
			key,
			sprite((px) => {
				px(4, 14, 8, 2, "rgba(0,0,0,0.25)");
				px(4, 7, 8, 7, colour); // body
				px(4, 1, 8, 6, "#f2c9a0"); // head
				px(4, 1, 8, 2, "#4a2f1b"); // hair
				for (const [ex, ey] of EYES[facing]) px(ex, ey, 2, 2, "#222");
			}),
		);
	return key;
}

const GROUND: Record<number, string> = {
	[T.path]: "path",
	[T.water]: "water",
	[T.farmland]: "farmland",
	[T.wall]: "wall",
	[T.roof]: "roof",
	[T.door]: "door",
	[T.bridge]: "bridge",
	[T.flowers]: "flowers",
};

const mod = (n: number, m: number) => ((n % m) + m) % m;
const grass = (x: number, y: number) => `grass${mod(x * 7 + y * 13, 4)}`;

function house(inst: TInstance, x: number, y: number, now: number): string {
	if (terrainAt(inst, x, y - 1, now) !== T.house) return "house_roof";
	if (x === HOUSE_DOOR.x && y === HOUSE_DOOR.y) return "house_door";
	return "house_wall";
}

/** Texture keys to stamp, bottom to top, for one tile */
export function tileLayers(inst: TInstance, x: number, y: number, now: number): string[] {
	const { cx, cy } = chunkOf(x, y);
	if (inst.kind === "land" && !inst.unlocked.has(chunkKey(cx, cy))) {
		// Locked: the land that is there, dimmed, fenced where it meets open land
		const base = landBaseTerrain(inst.seed, x, y);
		const out = [GROUND[base] ?? grass(x, y)];
		if (base === T.tree) out.push("tree");
		else if (base === T.rock) out.push("rock");
		out.push("dim");
		const lx = mod(x, CHUNK);
		const ly = mod(y, CHUNK);
		const open = (dx: number, dy: number) => inst.unlocked.has(chunkKey(cx + dx, cy + dy));
		if ((lx === 0 && open(-1, 0)) || (lx === CHUNK - 1 && open(1, 0)) || (ly === 0 && open(0, -1)) || (ly === CHUNK - 1 && open(0, 1)))
			out.push("fence");
		return out;
	}
	const terrain = terrainAt(inst, x, y, now);
	const tile = inst.tiles.get(tileKey(x, y));
	if (terrain === T.house) return [house(inst, x, y, now)];
	if (terrain === T.field) {
		if (tile?.regrowAt !== undefined && now < tile.regrowAt) return ["tilled"];
		return [`field:${fieldCrop(x, y) ?? "wheat"}`];
	}
	const out = [GROUND[terrain] ?? grass(x, y)];
	if (tile?.tilled) {
		const { day } = clock(inst.epoch, now);
		out.push(tile.wateredDays.includes(day) ? "watered" : "tilled");
		const stage = cropStage(tile, day);
		if (stage) out.push(stage.ready ? `ripe:${stage.crop.id}` : stage.grown === 0 ? "seedling" : "sprout");
	}
	if (terrain === T.tree) out.push("tree");
	else if (terrain === T.rock) out.push("rock");
	else if (terrain === T.portal) out.push("portal");
	else if (terrain === T.fence) out.push("fence");
	return out;
}
