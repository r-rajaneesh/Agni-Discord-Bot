// Item icons: tools, seed packets (with the crop on the label), produce, resources and animal drops
import { CROPS } from "../../game/data/crops";
import { ITEMS } from "../../game/data/items";
import { berry, cottonBoll, parsnipRoot, potato, pumpkin, wheatBundle } from "./crops";
import { OL, Pic, circle, darken, ellipse, group, lighten, line, path, rect, shadow } from "./lib";

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

const ore = (colour: string) => (p: Pic) => {
	let s = shadow(64, 104, 42, 9) + path("M24 96q-6 -24 12 -42q18 -16 42 -10q24 6 28 28q4 20 -6 26q-36 8 -76 -2z", p.shade(STONE, 0.28), { ol: true });
	for (const [x, y, r] of [[48, 68, 9], [76, 62, 7], [70, 86, 10], [90, 80, 6]] as const)
		s += path(`M${x - r} ${y}l${r * 0.6} ${-r}l${r} ${r * 0.2}l${r * 0.4} ${r * 0.9}l${-r} ${r * 0.6}z`, p.shade(colour, 0.25), { ol: true, extra: { "stroke-width": 3 } }) + circle(x - r * 0.3, y - r * 0.3, r * 0.25, "#ffffff", { op: 0.7 });
	return s;
};

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
	copper: ore("#d9783a"),
	iron: ore("#c9cfd6"),
	gold: ore("#ffcf40"),
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

/** A paper seed packet with its crop on the label */
function seedPacket(p: Pic, crop: string): string {
	const colour = CROPS[crop]!.colour;
	return (
		shadow(64, 112, 36, 7) +
		path("M30 26h68l4 82h-76z", p.shade("#f2e4c4", 0.15), { ol: true }) +
		path("M30 26l6 -8h56l6 8z", darken("#f2e4c4", 0.15), { ol: true }) +
		rect(34, 88, 60, 12, colour, { op: 0.9 }) +
		line("M30 88h68M30 100h70", OL, 2) +
		circle(64, 56, 29, "#fffaf0", { ol: true }) +
		group(produce[crop]!(p), `translate(${64 - 0.48 * 64} ${56 - 0.48 * 66}) scale(0.48)`) +
		circle(46, 94, 2.5, darken(colour, 0.4)) +
		circle(64, 94, 2.5, darken(colour, 0.4)) +
		circle(82, 94, 2.5, darken(colour, 0.4))
	);
}

export function itemIcon(id: string): string {
	const p = new Pic();
	const def = ITEMS[id]!;
	if (def.cropId) p.add(seedPacket(p, def.cropId));
	else if (produce[id]) p.add(produce[id]!(p));
	else p.add(ICONS[id]!(p));
	return p.svg();
}

