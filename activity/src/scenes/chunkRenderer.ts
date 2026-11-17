// Ground tiles, drawn lazily into one RenderTexture per 16×16 chunk near the camera
import type Phaser from "phaser";
import { CHUNK, chunkKey, chunkOf } from "@game/chunks";
import { clock, tileKey } from "@game/engine";
import type { ClientState } from "../state";
import { SCALE, SRC, TILE, tileLayers } from "../textures";

const CHUNK_PX = CHUNK * TILE;
// Chunks this many chunks from the camera centre are kept drawn
const RANGE = 2;

interface TChunk {
	rt: Phaser.GameObjects.RenderTexture;
	cx: number;
	cy: number;
	/** Game day it was drawn on; crops and cleared land change with the day */
	day: number;
	/** Earliest time a tile in it grows back, so it is redrawn then */
	nextChange: number;
}

export class ChunkRenderer {
	private chunks = new Map<string, TChunk>();

	constructor(
		private scene: Phaser.Scene,
		private state: ClientState,
	) {}

	/** Draws missing chunks around the camera, destroys far ones and redraws ones whose tiles changed with time */
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
				c.rt.destroy();
				this.chunks.delete(k);
			}
		const { day } = clock(inst.epoch, now);
		for (let cy = y0; cy <= y1; cy++)
			for (let cx = x0; cx <= x1; cx++) {
				const c = this.chunks.get(chunkKey(cx, cy));
				if (!c) this.create(cx, cy, now);
				else if (c.day !== day || now >= c.nextChange) this.draw(c, now);
			}
	}

	redrawAll(now: number): void {
		for (const c of this.chunks.values()) this.draw(c, now);
	}

	redrawTiles(keys: string[], now: number): void {
		const dirty = new Set<TChunk>();
		for (const k of keys) {
			const [x, y] = k.split(",").map(Number) as [number, number];
			const { cx, cy } = chunkOf(x, y);
			const c = this.chunks.get(chunkKey(cx, cy));
			if (c) dirty.add(c);
		}
		for (const c of dirty) this.draw(c, now);
	}

	clear(): void {
		for (const c of this.chunks.values()) c.rt.destroy();
		this.chunks.clear();
	}

	private create(cx: number, cy: number, now: number): void {
		// Drawn at source size and scaled up, so every sprite pixel stays a crisp 3×3 block
		const rt = this.scene.add
			.renderTexture(cx * CHUNK_PX, cy * CHUNK_PX, CHUNK * SRC, CHUNK * SRC)
			.setOrigin(0, 0)
			.setScale(SCALE)
			.setDepth(-1e9); // under every player, whose depth is its y
		const c: TChunk = { rt, cx, cy, day: 0, nextChange: Infinity };
		this.chunks.set(chunkKey(cx, cy), c);
		this.draw(c, now);
	}

	private draw(c: TChunk, now: number): void {
		const inst = this.state.instance;
		if (!inst) return;
		c.day = clock(inst.epoch, now).day;
		c.nextChange = Infinity;
		c.rt.clear();
		c.rt.beginDraw();
		for (let ly = 0; ly < CHUNK; ly++)
			for (let lx = 0; lx < CHUNK; lx++) {
				const x = c.cx * CHUNK + lx;
				const y = c.cy * CHUNK + ly;
				for (const key of tileLayers(inst, x, y, now)) c.rt.batchDrawFrame(key, undefined, lx * SRC, ly * SRC);
				const regrowAt = inst.tiles.get(tileKey(x, y))?.regrowAt;
				if (regrowAt !== undefined && regrowAt > now) c.nextChange = Math.min(c.nextChange, regrowAt);
			}
		c.rt.endDraw();
	}
}
