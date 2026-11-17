// Item icons: tools, seed packets (with the crop on the label), produce, resources and animal drops
import { Resvg } from "@resvg/resvg-js";
import { CROPS } from "../../game/data/crops";
import { ITEMS } from "../../game/data/items";
import { berry, cottonBoll, parsnipRoot, potato, pumpkin, wheatBundle } from "./crops";
import { OL, OW, Pic, circle, darken, ellipse, group, lighten, line, path, rect, shadow } from "./lib";

const WOOD = "#b98552";
const STEEL = "#b8c2cc";
const STONE = "#a8a196";

/** A wooden handle from (x1, y1) to (x2, y2) */
const handle = (x1: number, y1: number, x2: number, y2: number) => line(`M${x1} ${y1}L${x2} ${y2}`, OL, 12) + line(`M${x1} ${y1}L${x2} ${y2}`, WOOD, 8) + line(`M${x1 - 1} ${y1 - 2}L${x2 - 1} ${y2 - 2}`, lighten(WOOD, 0.4), 2.5, 0.7);

const produce: Record<string, (p: Pic) => string> = {
	parsnip: (p) => group(parsnipRoot(p, 0, 0, 20) + [-30, 0, 30].map((a) => group(path("M0 0Q9 -14 0 -30Q-9 -14 0 0z", p.shade("#5db04a", 0.25), { ol: true }), `rotate(${a})`)).join(""), "translate(64 52)"),
	wheat: (p) => wheatBundle(p, 64, 50, 1.35),
	potato: (p) => potato(p, 52, 72, 26) + potato(p, 80, 82, 18),
	berry: (p) => path("M64 40q-14 -10 -24 -2q12 2 24 2z", "#5db04a", { ol: true }) + berry(p, 50, 66, 15) + berry(p, 78, 64, 15) + berry(p, 64, 88, 15),
	cotton: (p) => cottonBoll(p, 64, 62, 34),
	pumpkin: (p) => pumpkin(p, 64, 72, 40),
};

// Each ore has its own colour and shape: copper in round lumps, iron in angular blocks, gold as nuggets
function copper(p: Pic): string {
	const c = "#d9783a";
	let s = shadow(64, 106, 44, 9);
	s += [[44, 76, 24], [80, 70, 26], [64, 92, 20]].map(([x, y, r]) => circle(x!, y!, r!, p.shade(c, 0.28), { ol: true })).join("");
	s += line("M40 70q6 8 2 16M78 62q-6 10 2 18", darken(c, 0.4), 3);
	for (const [x, y] of [[50, 66], [88, 80], [60, 98], [74, 60]] as const) s += circle(x, y, 3.5, "#5fb39b");
	return s + ellipse(72, 56, 9, 5, "#ffd2a8", { op: 0.7 }) + ellipse(36, 68, 6, 4, "#ffd2a8", { op: 0.6 });
}

function iron(p: Pic): string {
	const c = "#7d8ea3";
	let s = shadow(64, 106, 46, 9);
	s += path("M18 96l10 -38l30 -18l34 6l20 30l-6 22l-40 8z", p.shade(c, 0.3), { ol: true });
	s += path("M28 58l30 -18l6 26l-30 8z", lighten(c, 0.35), { op: 0.8 }) + path("M64 66l28 -20l20 30l-26 8z", darken(c, 0.15), { op: 0.8 });
	s += line("M58 40l6 26l22 18M34 74l30 -8", darken(c, 0.45), 3);
	for (const [x, y] of [[44, 86], [80, 94], [96, 72]] as const) s += circle(x, y, 3.5, "#b5653a");
	return s;
}

function gold(p: Pic): string {
	const c = "#ffcf40";
	const nugget = (x: number, y: number, r: number) => path(`M${x - r} ${y}q-2 ${-r * 0.8} ${r * 0.6} ${-r}q${r * 0.8} ${-r * 0.4} ${r * 1.3} ${r * 0.3}q${r * 0.4} ${r * 0.9} -${r * 0.3} ${r * 1.3}q-${r} ${r * 0.4} -${r * 1.6} -${r * 0.6}z`, p.shade(c, 0.3), { ol: true });
	let s = shadow(64, 106, 40, 8) + nugget(42, 90, 20) + nugget(86, 92, 18) + nugget(64, 68, 22);
	for (const [x, y] of [[58, 56], [36, 82], [82, 84]] as const) s += ellipse(x, y, 5, 3, "#fff6c8", { op: 0.9 });
	s += path("M100 40l3 9l9 3l-9 3l-3 9l-3 -9l-9 -3l9 -3z", "#fffbe0", { ol: false }) + path("M26 44l2 6l6 2l-6 2l-2 6l-2 -6l-6 -2l6 -2z", "#fffbe0");
	return s;
}

const ICONS: Record<string, (p: Pic) => string> = {
	hoe: (p) => handle(34, 110, 86, 30) + path("M78 34l8 -16q14 6 28 22l-4 30q-6 -18 -20 -24z", p.shade(STEEL, 0.25), { ol: true }) + rect(76, 22, 14, 14, p.shade(WOOD, 0.2), { ol: true, r: 3 }) + line("M100 34q6 6 8 16", "#ffffff", 3, 0.8),
	watering_can: (p) =>
		shadow(60, 108, 38, 8) +
		path("M84 62l24 -22l6 6l-22 26z", p.shade("#3e9e8c", 0.2), { ol: true }) +
		ellipse(110, 42, 7, 4, "#2e7b6c", { ol: true }) +
		path("M34 50a26 10 0 0 1 52 0v44q-26 12 -52 0z", p.shade("#4fb3a0", 0.22), { ol: true }) +
		ellipse(60, 50, 26, 9, darken("#4fb3a0", 0.25), { ol: true }) +
		path("M42 50q-2 -26 18 -28q20 2 18 28", "none", { extra: { stroke: OL, "stroke-width": 10, "stroke-linecap": "round" } }) +
		path("M42 50q-2 -26 18 -28q20 2 18 28", "none", { extra: { stroke: "#2e7b6c", "stroke-width": 5, "stroke-linecap": "round" } }) +
		rect(40, 60, 6, 26, "#ffffff", { op: 0.4, r: 3 }),
	axe: (p) => handle(36, 108, 84, 30) + path("M74 18q30 -6 40 18q-16 4 -18 22q-18 -6 -26 -22z", p.shade(STEEL, 0.25), { ol: true }) + line("M100 26q8 6 10 10", "#ffffff", 3, 0.8),
	pickaxe: (p) => handle(40, 108, 74, 40) + path("M22 42q40 -36 88 -6l-4 6q-42 -20 -78 6z", p.shade(STEEL, 0.25), { ol: true }) + rect(66, 30, 16, 16, p.shade(WOOD, 0.2), { ol: true, r: 3 }),
	wood: (p) => {
		const log = (x: number, y: number) =>
			rect(x - 34, y - 13, 60, 26, p.shade("#9b6a40", 0.2), { ol: true, r: 12 }) +
			ellipse(x + 26, y, 10, 13, "#e8c08a", { ol: true }) +
			ellipse(x + 26, y, 5.5, 7.5, "none", { extra: { stroke: "#b88a55", "stroke-width": 2 } }) +
			line(`M${x - 24} ${y - 5}h28`, darken("#9b6a40", 0.3), 2.5);
		return shadow(64, 104, 46, 8) + log(56, 88) + log(80, 88) + log(68, 64);
	},
	stone: (p) =>
		shadow(64, 102, 40, 9) +
		path("M26 96q-6 -24 12 -40q16 -14 38 -10q22 6 26 26q4 18 -6 24q-34 8 -70 0z", p.shade(STONE, 0.28), { ol: true }) +
		path("M38 60q14 -12 32 -10q-16 8 -18 22q-10 -2 -14 -12z", lighten(STONE, 0.45), { op: 0.7 }),
	copper,
	iron,
	gold,
	raw_meat: (p) =>
		shadow(64, 102, 40, 8) +
		path("M24 70q0 -30 40 -32q40 0 42 30q2 30 -42 32q-40 0 -40 -30z", "#fbeee0", { ol: true }) +
		path("M32 70q0 -22 32 -24q32 0 34 22q2 22 -34 24q-32 0 -32 -22z", p.shade("#d9534f", 0.2)) +
		path("M44 62q20 -6 40 6", "none", { extra: { stroke: "#f4c7c0", "stroke-width": 4, "stroke-linecap": "round" } }) +
		circle(76, 76, 6, "#fbeee0", { ol: true }),
	venison: (p) =>
		shadow(64, 104, 40, 8) +
		line("M84 46L104 26", OL, 14) +
		line("M84 46L104 26", "#fbf4e2", 9) +
		circle(106, 22, 7, "#fbf4e2", { ol: true }) +
		circle(110, 28, 7, "#fbf4e2", { ol: true }) +
		path("M30 88q-12 -30 18 -48q24 -12 40 6q12 18 -6 38q-24 22 -52 4z", p.shade("#a8443a", 0.22), { ol: true }) +
		ellipse(50, 60, 10, 6, "#e88a7f", { op: 0.6 }),
	hide: (p) =>
		shadow(64, 108, 44, 8) +
		path("M30 34q14 8 34 2q20 6 34 -2q4 14 -2 24q10 14 4 30q-4 16 6 22q-20 6 -42 -2q-22 8 -42 2q10 -6 6 -22q-6 -16 4 -30q-6 -10 -2 -24z", p.shade("#c08856", 0.2), { ol: true }) +
		path("M40 44q24 10 48 0M40 96q24 -8 48 0", "none", { extra: { stroke: "#8b5a36", "stroke-width": 2.5, "stroke-dasharray": "5 5" } }),
	feather: (p) =>
		group(
			path("M0 -48q22 18 14 52q-6 18 -14 26q-8 -8 -14 -26q-8 -34 14 -52z", p.shade("#f4efe6", 0.18), { ol: true }) +
				line("M0 -40V44", "#c9bfae", 3) +
				line("M0 -10l10 -10M0 6l11 -9M0 -10l-10 -10M0 6l-11 -9", "#d8cfbf", 2),
			"translate(64 62) rotate(30)",
		),
};

/** Seeds: the crop, large, with a small seed packet tucked in at the bottom left */
function seeds(p: Pic, crop: string): string {
	const colour = CROPS[crop]!.colour;
	return (
		group(produce[crop]!(p), "translate(14 -10)") +
		group(
			path("M0 8l4 -8h28l4 8v40h-36z", p.shade("#f2e4c4", 0.15), { ol: true }) +
				rect(4, 30, 28, 10, colour, { ol: false }) +
				line("M0 8h36", OL, 2.5) +
				[10, 18, 26].map((x) => ellipse(x, 20, 2.5, 3.5, darken("#c99a5e", 0.2))).join(""),
			"translate(4 84) scale(0.85)",
		)
	);
}

// Icons fill about 80% of the frame, centred, whatever size they were drawn at
const FILL = 104;

export function itemIcon(id: string): string {
	const p = new Pic();
	const def = ITEMS[id]!;
	if (def.cropId) p.add(seeds(p, def.cropId));
	else if (produce[id]) p.add(produce[id]!(p));
	else p.add(ICONS[id]!(p));
	// getBBox sees past the frame edge but leaves out strokes, so pad by the outline
	const box = new Resvg(p.svg()).getBBox();
	if (!box) return p.svg();
	const [w, h] = [box.width + OW * 2, box.height + OW * 2];
	const k = FILL / Math.max(w, h);
	return p.svg(false, { k, x: 64 - k * (box.x + box.width / 2), y: 64 - k * (box.y + box.height / 2) });
}

