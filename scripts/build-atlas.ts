// Rasterises the SVGs in art/<atlas>/ and packs each folder into activity/public/assets/<atlas>.png + .json
// (Phaser's JSON-hash atlas format). Build time only: the game loads the PNGs and never sees an SVG.
// Run: bun scripts/build-atlas.ts
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";

const ART = join(import.meta.dir, "..", "art");
const OUT = join(import.meta.dir, "..", "activity", "public", "assets");
const ITEM_RECTS = join(import.meta.dir, "..", "activity", "src", "assets", "items.frames.json");
export const ATLASES = ["tiles", "characters", "animals", "items", "ui"] as const;
// Each frame's edge pixels are repeated this far outwards, so linear filtering and mipmaps never sample a neighbour
const EXTRUDE = 4;

interface TImage {
	name: string;
	w: number;
	h: number;
	px: Uint8Array; // straight (not premultiplied) RGBA
}

function rasterise(file: string, name: string): TImage {
	const img = new Resvg(readFileSync(file), { fitTo: { mode: "original" }, shapeRendering: 2, textRendering: 1 }).render();
	const px = new Uint8Array(img.pixels);
	// resvg returns premultiplied alpha
	for (let i = 0; i < px.length; i += 4) {
		const a = px[i + 3]!;
		if (a > 0 && a < 255) for (let c = 0; c < 3; c++) px[i + c] = Math.min(255, Math.round((px[i + c]! * 255) / a));
	}
	return { name, w: img.width, h: img.height, px };
}

const pot = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

// PNG encoder: 8-bit RGBA, no filtering, zlib-compressed
const CRC = new Int32Array(256).map((_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c;
});
function crc32(buf: Uint8Array): number {
	let c = -1;
	for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
	return (c ^ -1) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const v = new DataView(out.buffer);
	v.setUint32(0, data.length);
	out.set(new TextEncoder().encode(type), 4);
	out.set(data, 8);
	v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}
function png(w: number, h: number, px: Uint8Array): Uint8Array {
	const ihdr = new Uint8Array(13);
	const v = new DataView(ihdr.buffer);
	v.setUint32(0, w);
	v.setUint32(4, h);
	ihdr.set([8, 6, 0, 0, 0], 8);
	const raw = new Uint8Array((w * 4 + 1) * h);
	for (let y = 0; y < h; y++) raw.set(px.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
	const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array())];
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}

/** Packs same-sized frames on a grid; the sheet is a power of two each way so mipmaps work */
function pack(atlas: string, images: TImage[]): void {
	const cw = Math.max(...images.map((i) => i.w)) + 2 * EXTRUDE;
	const ch = Math.max(...images.map((i) => i.h)) + 2 * EXTRUDE;
	const w = pot(Math.ceil(Math.sqrt(images.length)) * cw);
	const cols = Math.floor(w / cw);
	const h = pot(Math.ceil(images.length / cols) * ch);
	const px = new Uint8Array(w * h * 4);
	const frames: Record<string, unknown> = {};
	images.forEach((img, n) => {
		const fx = (n % cols) * cw + EXTRUDE;
		const fy = Math.floor(n / cols) * ch + EXTRUDE;
		// Every pixel of the cell copies the nearest pixel of the frame: the frame itself plus its extruded border
		for (let y = -EXTRUDE; y < img.h + EXTRUDE; y++)
			for (let x = -EXTRUDE; x < img.w + EXTRUDE; x++) {
				const sx = Math.min(img.w - 1, Math.max(0, x));
				const sy = Math.min(img.h - 1, Math.max(0, y));
				const s = (sy * img.w + sx) * 4;
				const d = ((fy + y) * w + fx + x) * 4;
				px.set(img.px.subarray(s, s + 4), d);
			}
		frames[img.name] = {
			frame: { x: fx, y: fy, w: img.w, h: img.h },
			rotated: false,
			trimmed: false,
			spriteSourceSize: { x: 0, y: 0, w: img.w, h: img.h },
			sourceSize: { w: img.w, h: img.h },
		};
	});
	const file = png(w, h, px);
	writeFileSync(join(OUT, `${atlas}.png`), file);
	const meta = { app: "scripts/build-atlas.ts", image: `${atlas}.png`, format: "RGBA8888", size: { w, h }, scale: "1" };
	writeFileSync(join(OUT, `${atlas}.json`), `${JSON.stringify({ frames, meta }, null, "\t")}\n`);
	// The DOM shows item icons as CSS backgrounds, so it needs the frame rects as a module it can import
	if (atlas === "items") {
		const rects = Object.fromEntries(Object.entries(frames).map(([k, v]) => [k, (v as { frame: unknown }).frame]));
		writeFileSync(ITEM_RECTS, `${JSON.stringify({ size: { w, h }, frames: rects }, null, "\t")}\n`);
	}
	console.log(`${atlas}: ${images.length} frames, ${w}×${h}, ${(file.length / 1024).toFixed(0)} KB`);
}

mkdirSync(OUT, { recursive: true });
for (const atlas of ATLASES) {
	const dir = join(ART, atlas);
	const files = readdirSync(dir)
		.filter((f) => f.endsWith(".svg"))
		.sort();
	pack(
		atlas,
		files.map((f) => rasterise(join(dir, f), f.slice(0, -4))),
	);
}
