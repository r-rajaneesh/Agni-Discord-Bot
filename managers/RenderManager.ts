import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { DIRS, clock, cropStage, darkness, facedTile, terrainAt, tileKey, type TWorldState } from "../game/engine";
import { MAP_H, MAP_W, PLOTS, T, baseTerrain } from "../game/map";

const SRC = 16; // sprite pixel size
const SCALE = 3;
export const TILE = SRC * SCALE; // 48px on screen
export const VIEW_W = 15;
export const VIEW_H = 9;

type TSprite = Canvas;

// Procedural 16×16 pixel art. Swap these for a CC0 tileset (e.g. Kenney) without touching the frame code.
function sprite(draw: (px: (x: number, y: number, w: number, h: number, c: string) => void) => void): TSprite {
	const c = createCanvas(SRC, SRC);
	const ctx = c.getContext("2d");
	draw((x, y, w, h, colour) => {
		ctx.fillStyle = colour;
		ctx.fillRect(x, y, w, h);
	});
	return c;
}

const grass = (seed: number) =>
	sprite((px) => {
		px(0, 0, 16, 16, "#5fa845");
		for (let i = 0; i < 6; i++) {
			const h = (seed * 31 + i * 17) % 256;
			px(h % 16, (h >> 4) % 16, 1, 2, "#4f9238");
		}
	});

const SPRITES = {
	grass: [0, 1, 2, 3].map(grass),
	path: sprite((px) => {
		px(0, 0, 16, 16, "#c9a86b");
		px(3, 4, 2, 1, "#b8955a");
		px(10, 11, 3, 1, "#b8955a");
		px(12, 2, 1, 1, "#b8955a");
	}),
	water: sprite((px) => {
		px(0, 0, 16, 16, "#3b7dd8");
		px(2, 4, 4, 1, "#6aa5ee");
		px(9, 10, 5, 1, "#6aa5ee");
	}),
	farmland: sprite((px) => {
		px(0, 0, 16, 16, "#8a6a43");
		px(0, 0, 16, 1, "#7a5c38");
		px(0, 0, 1, 16, "#7a5c38");
	}),
	tilled: sprite((px) => {
		px(0, 0, 16, 16, "#6b4a2b");
		for (let y = 2; y < 16; y += 4) px(1, y, 14, 1, "#563a20");
	}),
	watered: sprite((px) => {
		px(0, 0, 16, 16, "#4b331d");
		for (let y = 2; y < 16; y += 4) px(1, y, 14, 1, "#3a2714");
	}),
	wall: sprite((px) => {
		px(0, 0, 16, 16, "#d9c3a0");
		px(0, 7, 16, 1, "#b9a27f");
		px(7, 0, 1, 7, "#b9a27f");
		px(3, 8, 1, 8, "#b9a27f");
		px(11, 8, 1, 8, "#b9a27f");
	}),
	roof: sprite((px) => {
		px(0, 0, 16, 16, "#b0413e");
		for (let y = 1; y < 16; y += 3) px(0, y, 16, 1, "#8e2f2d");
	}),
	door: sprite((px) => {
		px(0, 0, 16, 16, "#d9c3a0");
		px(3, 2, 10, 14, "#7a4b24");
		px(4, 3, 8, 13, "#8e5a2c");
		px(10, 9, 1, 2, "#f1c40f");
	}),
	bridge: sprite((px) => {
		px(0, 0, 16, 16, "#3b7dd8");
		px(0, 1, 16, 14, "#9c7444");
		for (let x = 3; x < 16; x += 4) px(x, 1, 1, 14, "#7d5b33");
	}),
	flowers: sprite((px) => {
		px(0, 0, 16, 16, "#5fa845");
		px(3, 3, 2, 2, "#f5e663");
		px(10, 6, 2, 2, "#ef7fb0");
		px(5, 11, 2, 2, "#ffffff");
		px(12, 12, 2, 2, "#f5e663");
	}),
	tree: sprite((px) => {
		px(6, 10, 4, 6, "#6b4423");
		px(2, 1, 12, 10, "#2f7a32");
		px(3, 2, 6, 4, "#3f9142");
		px(1, 4, 14, 5, "#2f7a32");
	}),
	rock: sprite((px) => {
		px(2, 6, 12, 8, "#8b8f94");
		px(4, 4, 8, 3, "#9aa0a6");
		px(4, 7, 4, 2, "#b3b8bd");
		px(2, 13, 12, 1, "#6d7176");
	}),
	seedling: sprite((px) => {
		px(7, 8, 2, 5, "#3c9a3c");
		px(5, 8, 2, 2, "#57c157");
		px(9, 7, 2, 2, "#57c157");
	}),
	sprout: sprite((px) => {
		px(7, 4, 2, 10, "#3c9a3c");
		px(4, 6, 3, 3, "#57c157");
		px(9, 5, 3, 3, "#57c157");
		px(4, 10, 3, 2, "#57c157");
		px(9, 9, 3, 2, "#57c157");
	}),
};

const GROUND: Record<number, TSprite> = {
	[T.path]: SPRITES.path,
	[T.water]: SPRITES.water,
	[T.farmland]: SPRITES.farmland,
	[T.wall]: SPRITES.wall,
	[T.roof]: SPRITES.roof,
	[T.door]: SPRITES.door,
	[T.bridge]: SPRITES.bridge,
	[T.flowers]: SPRITES.flowers,
};

export default class RenderManager {
	/** The never-changing ground layer for the whole map, rendered once at screen scale */
	private ground: Canvas;
	private ripe = new Map<string, TSprite>();

	constructor() {
		this.ground = createCanvas(MAP_W * TILE, MAP_H * TILE);
		const ctx = this.ground.getContext("2d");
		ctx.imageSmoothingEnabled = false;
		for (let y = 0; y < MAP_H; y++)
			for (let x = 0; x < MAP_W; x++) {
				const t = baseTerrain(x, y);
				const s = GROUND[t] ?? (SPRITES.grass[(x * 7 + y * 13) % 4] as TSprite);
				ctx.drawImage(s, x * TILE, y * TILE, TILE, TILE);
			}
	}

	private ripeSprite(colour: string) {
		let s = this.ripe.get(colour);
		if (!s) {
			s = sprite((px) => {
				px(7, 3, 2, 6, "#3c9a3c");
				px(4, 4, 3, 2, "#57c157");
				px(9, 4, 3, 2, "#57c157");
				px(4, 8, 8, 6, colour);
				px(5, 9, 2, 2, "rgba(255,255,255,0.45)");
			});
			this.ripe.set(colour, s);
		}
		return s;
	}

	private drawPlayer(ctx: SKRSContext2D, px: number, py: number, colour: string, facing: keyof typeof DIRS) {
		const u = SCALE;
		ctx.fillStyle = "rgba(0,0,0,0.25)";
		ctx.fillRect(px + 4 * u, py + 14 * u, 8 * u, 2 * u);
		ctx.fillStyle = colour; // body
		ctx.fillRect(px + 4 * u, py + 7 * u, 8 * u, 7 * u);
		ctx.fillStyle = "#f2c9a0"; // head
		ctx.fillRect(px + 4 * u, py + 1 * u, 8 * u, 6 * u);
		ctx.fillStyle = "#4a2f1b"; // hair
		ctx.fillRect(px + 4 * u, py + 1 * u, 8 * u, 2 * u);
		ctx.fillStyle = "#222";
		const eyes: Record<string, [number, number][]> = {
			d: [[5, 4], [9, 4]],
			u: [],
			l: [[4, 4]],
			r: [[11, 4]],
		};
		(eyes[facing] ?? []).forEach(([ex, ey]) => ctx.fillRect(px + ex * u, py + ey * u, 2 * u, 2 * u));
	}

	/** Renders the viewport centred on `viewerId` as PNG */
	public async renderFrame(world: TWorldState, viewerId: string, now: number) {
		const viewer = world.players.get(viewerId);
		const canvas = createCanvas(VIEW_W * TILE, VIEW_H * TILE);
		const ctx = canvas.getContext("2d");
		ctx.imageSmoothingEnabled = false;

		const cx = Math.min(Math.max((viewer?.x ?? 0) - Math.floor(VIEW_W / 2), 0), MAP_W - VIEW_W);
		const cy = Math.min(Math.max((viewer?.y ?? 0) - Math.floor(VIEW_H / 2), 0), MAP_H - VIEW_H);
		const { day, minuteOfDay } = clock(world.epoch, now);

		ctx.drawImage(this.ground, cx * TILE, cy * TILE, VIEW_W * TILE, VIEW_H * TILE, 0, 0, VIEW_W * TILE, VIEW_H * TILE);

		for (let j = 0; j < VIEW_H; j++)
			for (let i = 0; i < VIEW_W; i++) {
				const x = cx + i;
				const y = cy + j;
				const sx = i * TILE;
				const sy = j * TILE;
				const terrain = terrainAt(world, x, y, day);
				const tile = world.tiles.get(tileKey(x, y));
				if (tile?.tilled) {
					ctx.drawImage(tile.wateredDays.includes(day) ? SPRITES.watered : SPRITES.tilled, sx, sy, TILE, TILE);
					const stage = cropStage(tile, day);
					if (stage) {
						const s = stage.ready
							? this.ripeSprite(stage.crop.colour)
							: stage.grown === 0
								? SPRITES.seedling
								: SPRITES.sprout;
						ctx.drawImage(s, sx, sy, TILE, TILE);
					}
				}
				const base = baseTerrain(x, y);
				if (base === T.tree || base === T.rock) {
					// Ground under removed trees/rocks is grass on the static layer already
					if (terrain === T.tree) ctx.drawImage(SPRITES.tree, sx, sy, TILE, TILE);
					else if (terrain === T.rock) ctx.drawImage(SPRITES.rock, sx, sy, TILE, TILE);
					else ctx.drawImage(SPRITES.grass[0] as TSprite, sx, sy, TILE, TILE);
				}
			}

		// Viewer's plot outline
		if (viewer?.plotId !== null && viewer?.plotId !== undefined) {
			const plot = PLOTS[viewer.plotId];
			if (plot) {
				ctx.strokeStyle = "rgba(241,196,15,0.9)";
				ctx.lineWidth = 3;
				ctx.strokeRect((plot.x - cx) * TILE + 1.5, (plot.y - cy) * TILE + 1.5, plot.w * TILE - 3, plot.h * TILE - 3);
			}
		}

		// Players, back to front
		const visible = [...world.players.values()]
			.filter((p) => p.x >= cx && p.x < cx + VIEW_W && p.y >= cy && p.y < cy + VIEW_H)
			.sort((a, b) => a.y - b.y);
		ctx.font = "bold 14px sans-serif";
		ctx.textAlign = "center";
		for (const p of visible) {
			const px = (p.x - cx) * TILE;
			const py = (p.y - cy) * TILE;
			this.drawPlayer(ctx, px, py, p.colour, p.facing);
			if (p.premium) {
				// Farm Pass crown
				const u = SCALE;
				ctx.fillStyle = "#f1c40f";
				ctx.fillRect(px + 4 * u, py - 1 * u, 8 * u, 2 * u);
				ctx.fillRect(px + 4 * u, py - 3 * u, 2 * u, 2 * u);
				ctx.fillRect(px + 7 * u, py - 3 * u, 2 * u, 2 * u);
				ctx.fillRect(px + 10 * u, py - 3 * u, 2 * u, 2 * u);
			}
			const label = p.name;
			const w = ctx.measureText(label).width + 10;
			ctx.fillStyle = "rgba(0,0,0,0.6)";
			const tagY = p.premium ? py - 9 * SCALE : py;
			ctx.fillRect(px + TILE / 2 - w / 2, tagY - 18, w, 18);
			ctx.fillStyle = p.userId === viewerId ? "#f1c40f" : "#ffffff";
			ctx.fillText(label, px + TILE / 2, tagY - 4);
		}

		// Faced-tile cursor
		if (viewer) {
			const f = facedTile(viewer);
			ctx.strokeStyle = "rgba(255,255,255,0.85)";
			ctx.lineWidth = 2;
			ctx.strokeRect((f.x - cx) * TILE + 2, (f.y - cy) * TILE + 2, TILE - 4, TILE - 4);
		}

		const dark = darkness(minuteOfDay);
		if (dark > 0) {
			ctx.fillStyle = `rgba(16,20,60,${dark})`;
			ctx.fillRect(0, 0, VIEW_W * TILE, VIEW_H * TILE);
		}
		return canvas.encode("png");
	}

	/** Line chart of hourly closes with a high/low band, for /market chart */
	public async renderChart(title: string, points: { hour: Date; close: number; high: number; low: number }[]) {
		const W = 720;
		const H = 320;
		const pad = { l: 56, r: 16, t: 40, b: 32 };
		const canvas = createCanvas(W, H);
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = "#1e1f22";
		ctx.fillRect(0, 0, W, H);
		ctx.fillStyle = "#ffffff";
		ctx.font = "bold 18px sans-serif";
		ctx.fillText(title, pad.l, 26);
		if (points.length < 2) {
			ctx.font = "15px sans-serif";
			ctx.fillStyle = "#b5bac1";
			ctx.fillText("Not enough history yet. Candles are written every hour.", pad.l, H / 2);
			return canvas.encode("png");
		}
		const lo = Math.min(...points.map((p) => p.low));
		const hi = Math.max(...points.map((p) => p.high));
		const span = hi - lo || 1;
		const x = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
		const y = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b);

		ctx.strokeStyle = "#3f4147";
		ctx.lineWidth = 1;
		ctx.font = "12px sans-serif";
		ctx.fillStyle = "#b5bac1";
		ctx.textAlign = "right";
		for (let g = 0; g <= 4; g++) {
			const v = lo + (span * g) / 4;
			ctx.beginPath();
			ctx.moveTo(pad.l, y(v));
			ctx.lineTo(W - pad.r, y(v));
			ctx.stroke();
			ctx.fillText(v.toFixed(v < 10 ? 2 : 0), pad.l - 6, y(v) + 4);
		}
		ctx.textAlign = "left";
		ctx.fillText(points[0]!.hour.toISOString().slice(5, 16).replace("T", " "), pad.l, H - 10);
		ctx.textAlign = "right";
		ctx.fillText(points.at(-1)!.hour.toISOString().slice(5, 16).replace("T", " ") + " UTC", W - pad.r, H - 10);

		ctx.fillStyle = "rgba(88,101,242,0.18)";
		ctx.beginPath();
		points.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.high)) : ctx.moveTo(x(i), y(p.high))));
		for (let i = points.length - 1; i >= 0; i--) ctx.lineTo(x(i), y(points[i]!.low));
		ctx.closePath();
		ctx.fill();

		ctx.strokeStyle = "#5865f2";
		ctx.lineWidth = 2.5;
		ctx.beginPath();
		points.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.close)) : ctx.moveTo(x(i), y(p.close))));
		ctx.stroke();
		return canvas.encode("png");
	}
}
