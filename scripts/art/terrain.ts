// Ground tiles (seamless: decoration stays clear of the edges, or repeats with a period that divides the tile)
// and the objects that stand on them: trees, rocks, fences, the portal and buildings
import { OL, OW, Pic, S, blob, circle, darken, ellipse, group, lighten, line, path, rect, rng, shadow, tag } from "./lib";

export const GRASS = { base: "#7cb84f", light: "#97cc63", dark: "#5f9a3c" };
export const SOIL = { base: "#8d5b3b", ridge: "#9f6a45", furrow: "#6b4229", top: "#b9845a" };
export const WET = { base: "#5e3a25", ridge: "#6e4530", furrow: "#43281a", top: "#86583a" };
const PATH = { base: "#e3c690", dark: "#c9a671", light: "#f1dcb0" };
const WATER = { base: "#3f9ed6", deep: "#3189c2", light: "#a9def6" };
const WOOD = { base: "#b98552", dark: "#8b5a36", light: "#d4a46e" };

const tuft = (x: number, y: number, c: string) => line(`M${x} ${y}l-4 -8M${x} ${y}l0 -10M${x} ${y}l4 -7`, c, 3);

/** Grass with soft mottling and a few tufts; `seed` moves them around */
export function grassBase(p: Pic, seed: number): void {
	const r = rng(seed * 977 + 13);
	const at = (m: number) => m + r() * (S - 2 * m);
	p.add(rect(0, 0, S, S, GRASS.base));
	for (let i = 0; i < 5; i++) p.add(ellipse(at(22), at(22), 10 + r() * 7, 6 + r() * 4, GRASS.light, { op: 0.35 }));
	for (let i = 0; i < 4; i++) p.add(ellipse(at(22), at(22), 9 + r() * 6, 5 + r() * 3, GRASS.dark, { op: 0.18 }));
	for (let i = 0; i < 7; i++) p.add(tuft(at(14), at(18), i % 3 ? GRASS.dark : lighten(GRASS.light, 0.2)));
}

export function grass(seed: number): Pic {
	const p = new Pic();
	grassBase(p, seed);
	return p;
}

export function pathTile(seed: number): Pic {
	const r = rng(seed * 131 + 7);
	const at = (m: number) => m + r() * (S - 2 * m);
	const p = new Pic().add(rect(0, 0, S, S, PATH.base));
	for (let i = 0; i < 6; i++) p.add(ellipse(at(20), at(20), 10 + r() * 8, 5 + r() * 4, PATH.light, { op: 0.4 }));
	for (let i = 0; i < 7; i++) {
		const x = at(14);
		const y = at(14);
		const s = 3 + r() * 4;
		p.add(ellipse(x + 1, y + 2, s, s * 0.7, PATH.dark), ellipse(x, y, s, s * 0.7, lighten(PATH.dark, 0.35)));
	}
	return p;
}

/** Water shimmer frame `f` of `n`: the ripples drift and fade in turn */
export function water(f: number, n: number): Pic {
	const p = new Pic().add(rect(0, 0, S, S, WATER.base));
	p.add(ellipse(40, 44, 26, 12, WATER.deep, { op: 0.35 }), ellipse(92, 94, 24, 10, WATER.deep, { op: 0.35 }));
	const ripples: [number, number][] = [
		[22, 26],
		[70, 40],
		[34, 76],
		[80, 100],
		[16, 108],
	];
	ripples.forEach(([x, y], i) => {
		const phase = (f + i) % n;
		const dx = phase * 4;
		p.add(line(`M${x + dx} ${y}q7 -6 14 0t14 0`, WATER.light, 3, 0.35 + 0.5 * (phase / (n - 1))));
	});
	const sparkles: [number, number][] = [
		[100, 22],
		[56, 62],
		[24, 92],
	];
	const [sx, sy] = sparkles[f % sparkles.length]!;
	p.add(circle(sx, sy, 3, "#ffffff", { op: 0.85 }), circle(sx + 6, sy + 4, 1.5, "#ffffff", { op: 0.6 }));
	return p;
}

export function farmland(): Pic {
	const r = rng(71);
	const p = new Pic().add(rect(0, 0, S, S, "#c4905c"));
	for (let i = 0; i < 14; i++) p.add(ellipse(12 + r() * 104, 12 + r() * 104, 2 + r() * 3, 1.5 + r() * 2, i % 2 ? "#a97a4a" : "#d6a874", { op: 0.8 }));
	return p;
}

/** Tilled soil: four rounded ridges with dark furrows, full width so they run on into the next tile */
export function soilRows(p: Pic, c: typeof SOIL): void {
	p.add(rect(0, 0, S, S, c.furrow));
	const r = rng(c.base.length * 31 + c.ridge.charCodeAt(1));
	for (let i = 0; i < 4; i++) {
		const y = i * 32 + 4;
		p.add(rect(0, y, S, 22, c.ridge), rect(0, y + 16, S, 6, c.base), rect(0, y + 2, S, 4, c.top, { op: 0.75 }));
		for (let k = 0; k < 5; k++) p.add(ellipse(10 + r() * 108, y + 9 + r() * 8, 3 + r() * 2, 2, k % 2 ? c.top : c.base, { op: 0.9 }));
	}
}

export function tilled(): Pic {
	const p = new Pic();
	soilRows(p, SOIL);
	return p;
}

export function watered(): Pic {
	const p = new Pic();
	soilRows(p, WET);
	for (const [x, y] of [
		[30, 22],
		[92, 54],
		[50, 86],
		[104, 118],
	] as const)
		p.add(ellipse(x, y, 6, 2, "#9fd4ef", { op: 0.55 }));
	return p;
}

// The town shop front: a plaster facade two tiles high with timber posts only at its outer ends, a striped
// awning and a signboard spanning the front, windows on alternate tiles and a stone footing
const PLASTER = "#f1e2c4";
export type TEnd = "l" | "m" | "r";
function plaster(p: Pic, e: TEnd): void {
	p.add(rect(0, 0, S, S, PLASTER));
	const r = rng(5);
	for (let i = 0; i < 6; i++) p.add(ellipse(16 + r() * 96, 20 + r() * 80, 4, 2, "#e2cfa8", { op: 0.8 }));
	if (e === "l") p.add(rect(0, 0, 12, S, p.shade(WOOD.dark, 0.15)), line("M12 0V128", OL, 3), line("M2 0V128", OL, 4));
	if (e === "r") p.add(rect(S - 12, 0, 12, S, p.shade(WOOD.dark, 0.15)), line("M116 0V128", OL, 3), line("M126 0V128", OL, 4));
}

function shopWindow(p: Pic, y: number): void {
	p.add(rect(30, y, 68, 50, "#fdf3dc", { ol: true, r: 4 }), rect(36, y + 6, 56, 38, p.radial([[0, "#cdeefa"], [1, "#7fbfdc"]], 0.3, 0.3, 0.9)));
	p.add(line(`M64 ${y + 6}v38M36 ${y + 25}h56`, "#fdf3dc", 4), path(`M40 ${y + 10}l12 0l-12 12z`, "#ffffff", { op: 0.7 }));
}

/** The awning along the top of the upper row: 16 px stripes, so it runs on across tiles */
function awning(p: Pic): void {
	p.add(rect(0, 0, S, 10, darken("#d65a3e", 0.3)));
	for (let i = 0; i < 8; i++) p.add(path(`M${i * 16} 6h16v18q-8 7 -16 0z`, i % 2 ? "#fdf3dc" : "#d65a3e"), line(`M${i * 16} 24q8 7 16 0`, OL, 2.5));
	p.add(line("M0 6H128", OL, 3), rect(0, 30, S, 6, "#1d140c", { op: 0.12 }));
}

/** Upper row: awning, then a window on alternate tiles (`win`) or plain plaster */
export function shopUpper(e: TEnd, win: boolean): Pic {
	const p = new Pic();
	plaster(p, e);
	awning(p);
	if (win) shopWindow(p, 46);
	// The beam between the floors runs the whole front
	p.add(rect(0, S - 10, S, 10, p.shade(WOOD.dark, 0.15)), line("M0 118H128", OL, 3));
	return p;
}

/** The signboard over the doors, in two halves: a wheat sheaf on the left, a coin on the right */
export function shopSign(half: "l" | "r"): Pic {
	const p = shopUpper("m", false);
	const x0 = half === "l" ? 14 : 0;
	const x1 = half === "l" ? 128 : 114;
	p.add(rect(x0, 44, x1 - x0, 56, p.shade("#a8713f", 0.2)), line(`M${x0} 44H${x1}M${x0} 100H${x1}`, OL, 4), rect(x0, 48, x1 - x0, 4, "#d4a46e", { op: 0.7 }));
	if (half === "l") {
		p.add(line("M14 44V100", OL, 4));
		for (const a of [-20, 0, 20]) p.add(group(line("M0 0V-30", "#f2c14e", 6) + ellipse(0, -30, 5, 9, "#f2c14e", { ol: true, extra: { "stroke-width": 2.5 } }), `translate(84 92) rotate(${a})`));
		p.add(rect(76, 78, 16, 7, "#c0392b", { ol: true, r: 2 }));
	} else {
		p.add(line("M114 44V100", OL, 4));
		p.add(circle(44, 72, 18, p.shade("#f2c14e", 0.25), { ol: true }), circle(44, 72, 11, "none", { extra: { stroke: "#c99a2e", "stroke-width": 3 } }), line("M44 64v16", "#c99a2e", 3));
	}
	for (const x of half === "l" ? [40] : [88]) p.add(line(`M${x} 36V44`, OL, 3));
	return p;
}

function footing(p: Pic): void {
	p.add(rect(0, 100, S, 28, "#a39c90"), line("M0 100H128", OL, 3));
	for (let i = 0; i < 4; i++) p.add(rect(i * 32 + 3, 105, 26, 9, "#bab3a7", { r: 3 }), rect(i * 32 + 19, 117, 26, 9, "#bab3a7", { r: 3 }));
}

/** Lower row: a window on alternate tiles, on the footing */
export function shopLower(e: TEnd, win: boolean): Pic {
	const p = new Pic();
	plaster(p, e);
	if (win) shopWindow(p, 30);
	footing(p);
	return p;
}

/** Shingles every 32 px (staggered by 16), so the roof repeats both ways */
function shingles(p: Pic, base: string, from = 0): void {
	p.add(rect(0, from, S, S - from, darken(base, 0.25)));
	for (let row = Math.floor(from / 32); row < 4; row++)
		for (let c = -1; c < 5; c++) {
			const x = c * 32 + (row % 2) * 16;
			const y = row * 32;
			if (y < from) continue;
			p.add(path(`M${x + 1} ${y}h30v18a15 12 0 0 1 -30 0z`, p.shade(base, 0.18)), line(`M${x + 1} ${y + 18}a15 12 0 0 0 30 0`, darken(base, 0.35), 3));
		}
}

const ROOF = "#cf5f3f";
export function roof(): Pic {
	const p = new Pic();
	shingles(p, ROOF);
	return p;
}

/** The top roof row: a capped ridge */
export function roofRidge(): Pic {
	const p = new Pic();
	shingles(p, ROOF, 32);
	p.add(rect(0, 0, S, 32, darken(ROOF, 0.15)), rect(0, 8, S, 22, p.shade("#a9462d", 0.2)), line("M0 8H128", OL, 3), line("M0 30H128", OL, 3), rect(0, 11, S, 4, lighten(ROOF, 0.4), { op: 0.5 }));
	return p;
}

function door(p: Pic, x: number, w: number, top: number): void {
	const d = `M${x} 128V${top + w / 2}a${w / 2} ${w / 2} 0 0 1 ${w} 0V128z`;
	p.add(path(d, p.shade("#8a5634", 0.2), { ol: true }));
	for (let i = 1; i < 4; i++) p.add(line(`M${x + (i * w) / 4} ${top + (i === 2 ? 2 : 8)}V126`, "#6b3f24", 3));
	p.add(circle(x + w - 10, top + w / 2 + 34, 4, "#f2c14e", { ol: false }), circle(x + w - 11, top + w / 2 + 33, 1.5, "#fff3c4"));
}

export function shopDoor(): Pic {
	const p = new Pic();
	plaster(p, "m");
	footing(p);
	door(p, 28, 72, 16);
	p.add(rect(22, 118, 84, 10, "#bab3a7", { ol: true, r: 2 }));
	return p;
}

export function bridge(): Pic {
	const p = new Pic().add(rect(0, 0, S, S, WOOD.dark));
	for (let i = 0; i < 8; i++) {
		const x = i * 16;
		p.add(rect(x + 1, 0, 14, S, i % 2 ? WOOD.base : lighten(WOOD.base, 0.08)), rect(x + 1, 0, 3, S, WOOD.light, { op: 0.6 }));
		p.add(circle(x + 8, 14, 1.8, "#5e3b22"), circle(x + 8, 114, 1.8, "#5e3b22"));
	}
	return p;
}

const PETALS = ["#ffffff", "#ffd84d", "#ff8fb1", "#b9a3e3"];
export function flowers(seed: number): Pic {
	const p = new Pic();
	grassBase(p, seed + 40);
	const r = rng(seed * 59 + 3);
	for (let i = 0; i < 7; i++) {
		const x = 18 + r() * 92;
		const y = 18 + r() * 92;
		const c = PETALS[Math.floor(r() * PETALS.length)]!;
		p.add(ellipse(x + 2, y + 3, 7, 3, GRASS.dark, { op: 0.4 }));
		for (let k = 0; k < 5; k++) {
			const a = (k / 5) * Math.PI * 2;
			p.add(circle(x + Math.cos(a) * 4.5, y + Math.sin(a) * 4.5, 3.6, c));
		}
		p.add(circle(x, y, 2.6, "#f0a020"));
	}
	return p;
}

/** A round leafy tree; variant 1 carries fruit */
export function tree(v: number): Pic {
	const p = new Pic();
	p.add(shadow(68, 112, 38, 10));
	p.add(path("M54 112q4 -8 4 -34h14q0 26 4 34q-11 4 -22 0z", p.shade("#8b5a36", 0.2), { ol: true }));
	const c = v === 0 ? [[64, 44, 36], [38, 62, 24], [90, 62, 24], [64, 70, 28]] : [[64, 40, 32], [40, 58, 26], [88, 56, 26], [62, 72, 28], [84, 78, 18]];
	const shapes = c.map(([x, y, rr]) => (f: string, o?: object) => circle(x!, y!, rr!, f, o));
	const leaf = v === 0 ? "#5aa846" : "#4f9d45";
	p.add(blob(shapes, leaf));
	const clip = p.clip(c.map(([x, y, rr]) => circle(x!, y!, rr!, "#000")).join(""));
	p.add(
		group(
			ellipse(88, 92, 46, 30, darken(leaf, 0.35), { op: 0.45 }) + ellipse(44, 30, 30, 20, lighten(leaf, 0.35), { op: 0.55 }) + circle(48, 30, 8, lighten(leaf, 0.55), { op: 0.5 }),
			undefined,
			undefined,
			clip,
		),
	);
	if (v === 1) for (const [x, y] of [[48, 56], [80, 46], [70, 78], [36, 72]] as const) p.add(circle(x, y, 5, "#e2503c", { ol: false }), circle(x - 1.5, y - 1.5, 1.6, "#ffd2c4"));
	return p;
}

const STONE = "#a8a196";
export function rock(v: number): Pic {
	const p = new Pic();
	p.add(shadow(66, 106, 42, 10));
	const big = "M22 100q-6 -26 12 -46q16 -18 40 -12q22 4 28 26q6 20 -2 32q-36 8 -78 0z";
	p.add(path(big, p.shade(STONE, 0.28), { ol: true }));
	p.add(path("M34 58q14 -14 34 -12q-16 8 -20 26q-10 -2 -14 -14z", lighten(STONE, 0.45), { op: 0.7 }), line("M74 62l8 12l-4 10", darken(STONE, 0.35), 3));
	if (v === 1) {
		p.add(shadow(100, 112, 16, 5), path("M86 112q-4 -14 8 -20q12 -4 18 6q4 8 0 14q-12 4 -26 0z", p.shade(STONE, 0.28), { ol: true }));
		p.add(ellipse(96, 98, 5, 3, lighten(STONE, 0.5), { op: 0.7 }));
	}
	return p;
}

/** A ring of standing stones around a swirl of light */
export function portal(): Pic {
	const p = new Pic();
	p.add(shadow(64, 110, 44, 10));
	p.add(circle(64, 64, 52, p.radial([[0, "#9ff0ff", 0.5], [1, "#9ff0ff", 0]], 0.5, 0.5, 0.5)));
	p.add(circle(64, 62, 40, "none", { extra: { stroke: OL, "stroke-width": 20 + OW * 2 } }), circle(64, 62, 40, "none", { extra: { stroke: "#9b958a", "stroke-width": 20 } }));
	p.add(circle(64, 62, 40, "none", { extra: { stroke: "#c3bdb1", "stroke-width": 6, "stroke-dasharray": "14 18", opacity: 0.8 } }));
	p.add(circle(64, 62, 30, p.radial([[0, "#f2feff"], [0.45, "#7fe1f7"], [1, "#2c8fc9"]], 0.45, 0.4, 0.65), { ol: true }));
	p.add(line("M64 62m-16 0a16 16 0 1 1 16 16a10 10 0 1 1 -8 -12", "#ffffff", 4, 0.75));
	for (const [x, y, r] of [[30, 20, 3], [100, 28, 2.5], [104, 96, 3], [22, 92, 2]] as const) p.add(circle(x, y, r, "#e6fbff", { op: 0.9 }));
	return p;
}

/** A wooden fence running across the tile (`h`) or down it (`v`) */
export function fence(dir: "h" | "v"): Pic {
	const p = new Pic();
	const post = (x: number, y: number) =>
		path(`M${x} ${y + 40}v-34l7 -6l7 6v34z`, p.shade(WOOD.base, 0.25), { ol: true }) + rect(x + 2, y + 6, 3, 30, WOOD.light, { op: 0.6 });
	if (dir === "h") {
		p.add(rect(0, 96, S, 10, "#1d140c", { op: 0.15 }));
		for (const y of [58, 80]) p.add(rect(0, y, S, 11, WOOD.base), line(`M0 ${y}H128`, OL, 3), line(`M0 ${y + 11}H128`, OL, 3), rect(0, y + 2, S, 3, WOOD.light, { op: 0.6 }));
		p.add(post(14, 56), post(100, 56));
	} else {
		p.add(rect(68, 0, 10, S, "#1d140c", { op: 0.15 }));
		p.add(rect(57, 0, 12, S, WOOD.base), line("M57 0V128", OL, 3), line("M69 0V128", OL, 3), rect(59, 0, 3, S, WOOD.light, { op: 0.6 }));
		p.add(post(56, -2), post(56, 62));
	}
	return p;
}

// The player's house: a dusty-blue roof row, a sided wall with windows, a stone footing and the door
const HROOF = "#5b7fa6";
const SIDING = "#e6b77f";
const ends = (p: Pic, e: TEnd, colour: string) => {
	if (e === "l") p.add(rect(0, 0, 10, S, colour), line("M10 0V128", OL, 3), line("M2 0V128", OL, 4));
	if (e === "r") p.add(rect(S - 10, 0, 10, S, colour), line("M118 0V128", OL, 3), line("M126 0V128", OL, 4));
};

export function houseRoof(e: TEnd): Pic {
	const p = new Pic();
	shingles(p, HROOF, 32);
	p.add(rect(0, 0, S, 32, darken(HROOF, 0.2)), rect(0, 6, S, 24, p.shade("#46658a", 0.2)), line("M0 6H128", OL, 3), line("M0 30H128", OL, 3));
	p.add(rect(0, 9, S, 4, lighten(HROOF, 0.5), { op: 0.5 }));
	p.add(rect(0, 116, S, 12, darken(HROOF, 0.45)), line("M0 116H128", OL, 3));
	ends(p, e, darken(HROOF, 0.3));
	return p;
}

function siding(p: Pic): void {
	p.add(rect(0, 0, S, S, SIDING));
	for (let y = 0; y < S; y += 16) p.add(rect(0, y, S, 4, lighten(SIDING, 0.3), { op: 0.6 }), line(`M0 ${y + 15}H128`, darken(SIDING, 0.3), 2));
}

export function houseWall(e: TEnd): Pic {
	const p = new Pic();
	siding(p);
	p.add(rect(0, 0, S, 10, "#1d140c", { op: 0.2 }));
	p.add(rect(38, 30, 52, 52, "#fdf3dc", { ol: true, r: 4 }), rect(44, 36, 40, 40, p.radial([[0, "#d6f2fb"], [1, "#78b7d6"]], 0.3, 0.3, 0.9)));
	p.add(line("M64 36v40M44 56h40", "#fdf3dc", 4), path("M48 40l10 0l-10 10z", "#ffffff", { op: 0.7 }));
	p.add(rect(34, 82, 60, 12, p.shade("#8b5a36", 0.2), { ol: true, r: 3 }));
	for (const [x, c] of [[42, "#ff8fb1"], [56, "#ffd84d"], [72, "#ffffff"], [86, "#ff8fb1"]] as const) p.add(circle(x, 80, 5, c, { ol: false }), circle(x, 80, 2, "#f0a020"));
	ends(p, e, "#8b5a36");
	return p;
}

export function houseBase(e: TEnd): Pic {
	const p = new Pic();
	siding(p);
	footing(p);
	ends(p, e, "#8b5a36");
	return p;
}

export function houseDoor(): Pic {
	const p = new Pic();
	siding(p);
	footing(p);
	door(p, 36, 56, 18);
	p.add(rect(30, 118, 68, 10, "#bab3a7", { ol: true, r: 2 }));
	return p;
}

/**
 * A river or pond bank drawn over a water tile, on the sides (bits N=1, E=2, S=4, W=8) that border land.
 * Two land sides that meet get a rounded corner.
 */
export function shore(mask: number): Pic {
	const p = new Pic();
	const land = (bit: number) => (mask & bit) !== 0;
	const t = land(1) ? 18 : -30;
	const r = land(2) ? S - 18 : S + 30;
	const b = land(4) ? S - 18 : S + 30;
	const l = land(8) ? 18 : -30;
	const rad = (a: number, c: number) => (land(a) && land(c) ? 24 : 0);
	const [tl, tr, br, bl] = [rad(8, 1), rad(1, 2), rad(2, 4), rad(4, 8)];
	const inner = (o: number) =>
		`M${l + tl + o} ${t + o}H${r - tr - o}${tr ? `A${tr} ${tr} 0 0 1 ${r - o} ${t + tr + o}` : ""}V${b - br - o}${br ? `A${br} ${br} 0 0 1 ${r - br - o} ${b - o}` : ""}H${l + bl + o}${bl ? `A${bl} ${bl} 0 0 1 ${l + o} ${b - bl - o}` : ""}V${t + tl + o}${tl ? `A${tl} ${tl} 0 0 1 ${l + tl + o} ${t + o}` : ""}z`;
	p.add(tag("path", { d: `M0 0H128V128H0z${inner(0)}`, fill: GRASS.base, "fill-rule": "evenodd" }));
	p.add(line(inner(4), "#1d140c", 6, 0.12), line(inner(0), PATH.light, 7), line(inner(0), darken(PATH.dark, 0.2), 2.5, 0.7), line(inner(9), "#e8f7ff", 2.5, 0.55));
	return p;
}

/** Locked land: a translucent veil */
export function dim(): Pic {
	return new Pic().add(rect(0, 0, S, S, "#0b0d1a", { op: 0.5 }));
}

