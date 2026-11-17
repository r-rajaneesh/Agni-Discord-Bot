// Ground tiles: one Blitter per 16×16 chunk near the camera, one bob per tile layer, drawn straight from the
// mipmapped tiles atlas at camera resolution (no render textures)
import type Phaser from "phaser";
import { CHUNK, chunkKey, chunkOf } from "@game/chunks";
import { clock, tileKey } from "@game/engine";
import type { ClientState } from "../state";
import { DRAW_SCALE, SRC_TILE, TILE } from "../assets/manifest";
import { isWaterFrame, tileLayers, waterFrame, waterStep } from "../textures";

const CHUNK_PX = CHUNK * TILE;
// Chunks this many chunks from the camera centre are kept drawn
const RANGE = 2;

interface TChunk {
	// Phaser's Blitter ignores its own scale, so it sits in a container that scales atlas pixels to world pixels
	root: Phaser.GameObjects.Container;
	blitter: Phaser.GameObjects.Blitter;
	/** Bobs of each tile, bottom to top, by local index ly * CHUNK + lx */
	tiles: Phaser.GameObjects.Bob[][];
	/** Water bobs and their tiles, so the shimmer only swaps frames */
	water: { bob: Phaser.GameObjects.Bob; x: number; y: number }[];
	cx: number;
	cy: number;
	/** Game day it was drawn on; crops and cleared land change with the day */
	day: number;
	/** Earliest time a tile in it grows back, so it is redrawn then */
	nextChange: number;
}

export class ChunkRenderer {
	private chunks = new Map<string, TChunk>();
	private step = 0;

	constructor(
		private scene: Phaser.Scene,
		private state: ClientState,
	) {}

	/** Draws missing chunks around the camera, destroys far ones, redraws ones whose tiles changed with time */
	update(cam: Phaser.Cameras.Scene2D.Camera, now: number): void {
		const inst = this.state.instance;
		if (!inst) return;
		const view = cam.worldView;
		const mx = Math.floor(cam.midPoint.x / CHUNK_PX);
		const my = Math.floor(cam.midPoint.y / CHUNK_PX);
		// Always covers the visible area too, on a screen wider than five chunks
		const x0 = Math.min(mx - RANGE, Math.floor(view.x / CHUNK_PX));
		const x1 = Math.max(mx + RANGE, Math.floor(view.right / CHUNK_PX));
		const y0 = Math.min(my - RANGE, Math.floor(view.y / CHUNK_PX));
		const y1 = Math.max(my + RANGE, Math.floor(view.bottom / CHUNK_PX));
		for (const [k, c] of this.chunks)
			if (c.cx < x0 || c.cx > x1 || c.cy < y0 || c.cy > y1) {
				c.root.destroy();
				this.chunks.delete(k);
			}
		const { day } = clock(inst.epoch, now);
		for (let cy = y0; cy <= y1; cy++)
			for (let cx = x0; cx <= x1; cx++) {
				const c = this.chunks.get(chunkKey(cx, cy));
				if (!c) this.create(cx, cy, now);
				else if (c.day !== day || now >= c.nextChange) this.draw(c, now);
			}
		const step = waterStep(now);
		if (step !== this.step) {
			this.step = step;
			for (const c of this.chunks.values()) for (const w of c.water) w.bob.setFrame(waterFrame(w.x, w.y, now));
		}
	}

	redrawAll(now: number): void {
		for (const c of this.chunks.values()) this.draw(c, now);
	}

	/** Rebuilds only the bobs of the tiles that changed */
	redrawTiles(keys: string[], now: number): void {
		for (const k of keys) {
			const [x, y] = k.split(",").map(Number) as [number, number];
			const { cx, cy } = chunkOf(x, y);
			const c = this.chunks.get(chunkKey(cx, cy));
			if (!c) continue;
			const i = (y - cy * CHUNK) * CHUNK + (x - cx * CHUNK);
			for (const bob of c.tiles[i] ?? []) bob.destroy();
			c.water = c.water.filter((w) => w.x !== x || w.y !== y);
			this.drawTile(c, x, y, now);
		}
	}

	clear(): void {
		for (const c of this.chunks.values()) c.root.destroy();
		this.chunks.clear();
	}

	/** Bobs in all drawn chunks, for the report and tests of draw cost */
	bobCount(): number {
		let n = 0;
		for (const c of this.chunks.values()) n += c.blitter.children.length;
		return n;
	}

	private create(cx: number, cy: number, now: number): void {
		const blitter = this.scene.make.blitter({ key: "tiles", add: false });
		const root = this.scene.add
			.container(cx * CHUNK_PX, cy * CHUNK_PX, [blitter])
			.setScale(DRAW_SCALE)
			.setDepth(-1e9); // under every player, whose depth is its y
		const c: TChunk = { root, blitter, tiles: [], water: [], cx, cy, day: 0, nextChange: Infinity };
		this.chunks.set(chunkKey(cx, cy), c);
		this.draw(c, now);
	}

	private draw(c: TChunk, now: number): void {
		const inst = this.state.instance;
		if (!inst) return;
		c.day = clock(inst.epoch, now).day;
		c.nextChange = Infinity;
		c.blitter.clear();
		c.tiles = [];
		c.water = [];
		for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) this.drawTile(c, c.cx * CHUNK + lx, c.cy * CHUNK + ly, now);
	}

	private drawTile(c: TChunk, x: number, y: number, now: number): void {
		const inst = this.state.instance;
		if (!inst) return;
		const lx = x - c.cx * CHUNK;
		const ly = y - c.cy * CHUNK;
		const bobs = tileLayers(inst, x, y, now).map((frame) => {
			const bob = c.blitter.create(lx * SRC_TILE, ly * SRC_TILE, frame);
			if (isWaterFrame(frame)) c.water.push({ bob, x, y });
			return bob;
		});
		c.tiles[ly * CHUNK + lx] = bobs;
		const regrowAt = inst.tiles.get(tileKey(x, y))?.regrowAt;
		if (regrowAt !== undefined && regrowAt > now) c.nextChange = Math.min(c.nextChange, regrowAt);
	}
}

