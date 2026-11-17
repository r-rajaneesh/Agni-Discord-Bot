// Crops: one frame per growth stage (growDays + 1, the last one ripe), the produce itself (shared with the
// item icons) and the public field tile
import { CROPS } from "../../game/data/crops";
import { OL, Pic, blob, circle, darken, ellipse, group, lighten, line, mix, path } from "./lib";
import { SOIL, soilRows } from "./terrain";

const LEAF = "#5db04a";
const DEEP = "#3f8a3a";

/** A pointed leaf growing from (x, y) at angle a (degrees, 0 = straight up) */
export function leaf(p: Pic, x: number, y: number, len: number, w: number, a: number, colour = LEAF): string {
	const d = `M0 0C${w * 1.6} ${-len * 0.25} ${w * 1.2} ${-len * 0.75} 0 ${-len}C${-w * 1.2} ${-len * 0.75} ${-w * 1.6} ${-len * 0.25} 0 0z`;
	return group(path(d, p.shade(colour, 0.25), { ol: true }) + line(`M0 -4L0 ${-len * 0.7}`, darken(colour, 0.3), 2, 0.6), `translate(${x} ${y}) rotate(${a})`);
}

const mound = (p: Pic) => ellipse(64, 104, 22, 7, darken(SOIL.ridge, 0.15), { op: 0.9 }) + ellipse(62, 102, 14, 4, SOIL.top, { op: 0.6 });

// Produce, centred on (cx, cy) with size r. Item icons and ripe crops share these.
export function parsnipRoot(p: Pic, cx: number, cy: number, r: number): string {
	const d = `M${cx - r} ${cy}Q${cx - r * 0.9} ${cy + r * 1.2} ${cx} ${cy + r * 2.6}Q${cx + r * 0.9} ${cy + r * 1.2} ${cx + r} ${cy}Q${cx} ${cy - r * 0.6} ${cx - r} ${cy}z`;
	return (
		path(d, p.shade("#f0d9a2", 0.25), { ol: true }) +
		line(`M${cx - r * 0.55} ${cy + r * 0.6}h${r * 0.5}M${cx + r * 0.1} ${cy + r * 1.2}h${r * 0.45}M${cx - r * 0.3} ${cy + r * 1.8}h${r * 0.35}`, darken("#f0d9a2", 0.3), 2.5) +
		ellipse(cx - r * 0.45, cy + r * 0.25, r * 0.22, r * 0.4, "#fffbe9", { op: 0.7 })
	);
}

export function potato(p: Pic, cx: number, cy: number, r: number): string {
	return (
		group(ellipse(0, 0, r, r * 0.74, p.shade("#c99a5e", 0.25), { ol: true }), `translate(${cx} ${cy}) rotate(-12)`) +
		[[-0.4, -0.2], [0.3, 0.1], [-0.05, 0.35]].map(([dx, dy]) => circle(cx + dx! * r, cy + dy! * r, r * 0.08, darken("#c99a5e", 0.4))).join("") +
		ellipse(cx - r * 0.4, cy - r * 0.35, r * 0.3, r * 0.16, "#f4dcb4", { op: 0.6 })
	);
}

export function berry(p: Pic, cx: number, cy: number, r: number): string {
	return circle(cx, cy, r, p.shade("#5260d6", 0.3), { ol: true }) + circle(cx - r * 0.35, cy - r * 0.35, r * 0.28, "#d8dcff", { op: 0.8 }) + circle(cx + r * 0.2, cy + r * 0.15, r * 0.18, darken("#5260d6", 0.4));
}

export function cottonBoll(p: Pic, cx: number, cy: number, r: number): string {
	const puffs: [number, number, number][] = [
		[-0.45, 0.1, 0.55],
		[0.45, 0.1, 0.55],
		[0, -0.3, 0.6],
		[0, 0.3, 0.55],
	];
	const calyx = path(`M${cx - r * 0.8} ${cy + r * 0.5}l${r * 0.4} ${r * 0.5}l${r * 0.4} -${r * 0.3}l${r * 0.4} ${r * 0.3}l${r * 0.4} -${r * 0.5}z`, "#8b5a36", { ol: true });
	return calyx + blob(puffs.map(([dx, dy, k]) => (f: string, o?: object) => circle(cx + dx * r, cy + dy * r, k * r, f, o)), "#fbf7ee") + circle(cx - r * 0.25, cy - r * 0.4, r * 0.22, "#ffffff");
}

export function pumpkin(p: Pic, cx: number, cy: number, r: number): string {
	const fill = p.shade("#ee8a2a", 0.25);
	return (
		ellipse(cx - r * 0.45, cy, r * 0.6, r * 0.8, fill, { ol: true }) +
		ellipse(cx + r * 0.45, cy, r * 0.6, r * 0.8, fill, { ol: true }) +
		ellipse(cx, cy, r * 0.6, r * 0.85, fill, { ol: true }) +
		ellipse(cx - r * 0.15, cy - r * 0.35, r * 0.18, r * 0.3, "#ffd39a", { op: 0.6 }) +
		path(`M${cx - 4} ${cy - r * 0.8}q2 -${r * 0.4} 10 -${r * 0.5}l3 5q-6 3 -5 ${r * 0.45}z`, "#6b8a2e", { ol: true })
	);
}

/** One ear of wheat on its stalk */
function ear(p: Pic, x: number, y: number, len: number, a: number, colour: string): string {
	let s = line(`M0 0V${-len}`, darken(colour, 0.25), 3);
	for (let i = 0; i < 4; i++) {
		const yy = -len + 6 + i * 8;
		for (const dx of [-4, 4]) s += ellipse(dx, yy + (dx > 0 ? 4 : 0), 4.5, 7, p.shade(colour, 0.2), { extra: { stroke: darken(colour, 0.55), "stroke-width": 2 } });
	}
	return group(s, `translate(${x} ${y}) rotate(${a})`);
}

export function wheatBundle(p: Pic, cx: number, cy: number, k: number): string {
	const gold = "#e6bd4f";
	let s = "";
	for (const a of [-24, -12, 0, 12, 24]) s += ear(p, cx, cy + 30 * k, 64 * k, a, gold);
	return s + path(`M${cx - 10 * k} ${cy + 10 * k}h${20 * k}v${8 * k}h${-20 * k}z`, "#c0392b", { ol: true });
}

type TStage = (p: Pic, g: number, ripe: boolean) => string;

// Each crop's plant; g runs 0..1 over the growing stages before ripe
const PLANTS: Record<string, TStage> = {
	parsnip: (p, g, ripe) => {
		const len = 34 + 34 * g;
		let s = mound(p);
		for (const a of [-38, -14, 10, 34]) s += leaf(p, 64, 98, len * (Math.abs(a) > 20 ? 0.85 : 1), 9, a);
		// The shoulder of the root shows above the soil
		if (ripe) s += path("M48 104q0 -16 16 -16q16 0 16 16z", p.shade("#f0d9a2", 0.25), { ol: true }) + line("M54 98h8M66 101h7", darken("#f0d9a2", 0.3), 2.5);
		return s;
	},
	wheat: (p, g, ripe) => {
		const colour = ripe ? "#e6bd4f" : mix(LEAF, "#b9c95a", g * 0.5);
		let s = mound(p);
		const angles = [-26, -13, 0, 13, 26];
		if (ripe) for (const a of angles) s += ear(p, 64, 100, 78, a, colour);
		else for (const a of angles) s += leaf(p, 64, 100, 40 + 40 * g, 8, a * 0.8, colour);
		return s;
	},
	potato: (p, g, ripe) => {
		let s = mound(p);
		if (ripe) s += potato(p, 44, 104, 11) + potato(p, 86, 106, 10);
		const r = 14 + 10 * g;
		const leaves: [number, number][] = [[-r * 1.1, 0], [r * 1.1, 0], [0, -r * 0.9], [-r * 0.6, -r * 1.6], [r * 0.6, -r * 1.6]];
		s += blob(leaves.slice(0, 3 + Math.round(g * 2)).map(([dx, dy]) => (f: string, o?: object) => ellipse(64 + dx, 90 + dy, r * 0.8, r * 0.6, f, o)), "#4ea648");
		s += ellipse(56, 80 - r * 0.6, r * 0.6, r * 0.25, lighten("#4ea648", 0.4), { op: 0.5 });
		if (ripe) for (const [x, y] of [[52, 62], [74, 58], [66, 74]] as const) s += flower(x, y, "#f2e6ff");
		return s;
	},
	berry: (p, g, ripe) => bush(p, 0.45 + 0.55 * g, ripe ? "ripe" : g >= 0.99 ? "green" : "none", "berry"),
	cotton: (p, g, ripe) => bush(p, 0.45 + 0.55 * g, ripe ? "ripe" : g >= 0.99 ? "green" : "none", "cotton"),
	pumpkin: (p, g, ripe) => {
		let s = mound(p);
		const r = 10 + 12 * g;
		const at: [number, number][] = [[40, 92], [88, 92], [64, 78], [30, 74], [98, 74]];
		s += line(`M24 100Q64 ${86 - 10 * g} 104 100`, DEEP, 4);
		s += blob(at.slice(0, 2 + Math.round(g * 3)).map(([x, y]) => (f: string, o?: object) => circle(x, y, r, f, o)), "#55a64a");
		for (const [x, y] of at.slice(0, 2 + Math.round(g * 3))) s += line(`M${x} ${y}l0 ${-r * 0.6}M${x} ${y}l${-r * 0.5} ${-r * 0.3}M${x} ${y}l${r * 0.5} ${-r * 0.3}`, DEEP, 2, 0.6);
		if (ripe) s += pumpkin(p, 64, 88, 28);
		else if (g >= 0.99) s += pumpkin(p, 64, 96, 12);
		else if (g >= 0.79) s += flower(64, 80, "#ffd84d", 7);
		return s;
	},
};


function flower(x: number, y: number, colour: string, r = 5): string {
	let s = "";
	for (let k = 0; k < 5; k++) {
		const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
		s += circle(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8, r * 0.7, colour, { extra: { stroke: OL, "stroke-width": 1.5 } });
	}
	return s + circle(x, y, r * 0.45, "#f0a020");
}

/** A round bush; berries or cotton bolls show green first, then ripe */
function bush(p: Pic, k: number, fruit: "none" | "green" | "ripe", kind: "berry" | "cotton"): string {
	let s = mound(p);
	const r = 34 * k;
	const cy = 100 - r * 0.9;
	const parts: [number, number, number][] = [[0, 0, 1], [-0.7, 0.35, 0.7], [0.7, 0.35, 0.7]];
	if (kind === "cotton") s += line(`M64 102V${cy - r * 0.2}M64 ${cy + r * 0.3}l${-r * 0.6} ${-r * 0.5}M64 ${cy + r * 0.3}l${r * 0.6} ${-r * 0.5}`, "#7a5232", 4);
	const green = kind === "berry" ? "#4b9c46" : "#62ad4c";
	s += blob(parts.map(([dx, dy, m]) => (f: string, o?: object) => circle(64 + dx * r, cy + dy * r, m * r, f, o)), green);
	s += ellipse(64 - r * 0.35, cy - r * 0.45, r * 0.4, r * 0.22, lighten(green, 0.45), { op: 0.5 });
	const spots: [number, number][] = [[-0.45, -0.1], [0.4, -0.25], [0.05, 0.3], [-0.75, 0.5], [0.75, 0.45]];
	if (fruit === "none") return s;
	for (const [dx, dy] of spots) {
		const x = 64 + dx * r;
		const y = cy + dy * r;
		if (kind === "berry") s += fruit === "ripe" ? berry(p, x, y, 6.5) : circle(x, y, 4.5, "#b5d97a", { extra: { stroke: darken("#4b9c46", 0.3), "stroke-width": 2 } });
		else s += fruit === "ripe" ? cottonBoll(p, x, y, 10) : circle(x, y, 5.5, "#a7cf6a", { extra: { stroke: darken("#62ad4c", 0.3), "stroke-width": 2 } });
	}
	return s;
}

/** Growth stage `s` of a crop: 0 is a seedling, growDays is ripe */
export function cropStage(id: string, s: number): Pic {
	const n = CROPS[id]!.growDays;
	const p = new Pic();
	if (s === 0) {
		p.add(mound(p), line("M64 102V84", DEEP, 4), leaf(p, 64, 88, 18, 8, -55, LEAF), leaf(p, 64, 88, 18, 8, 55, LEAF));
		return p;
	}
	const ripe = s >= n;
	p.add(PLANTS[id]!(p, ripe ? 1 : n > 2 ? (s - 1) / (n - 2) : 1, ripe));
	return p;
}

/** A public field: tilled rows with four ripe plants */
export function field(id: string): Pic {
	const p = new Pic();
	soilRows(p, SOIL);
	const inner = PLANTS[id]!(p, 1, true);
	// Plain scaling here, outline and all: four small plants read better with a finer line
	for (const [x, y] of [[0, -4], [64, -4], [0, 58], [64, 58]] as const) p.add(group(inner, `translate(${x} ${y}) scale(0.5)`));
	return p;
}

