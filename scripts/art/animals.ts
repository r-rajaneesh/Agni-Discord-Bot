// Wild animals, top-down three-quarter view like the farmer. Side views face left; right is the mirror.
// Frames: 0 standing, 1 and 2 mid-step (a hop for the rabbit, a waddle for the duck).
import { Pic, circle, darken, ellipse, group, lighten, line, path, rect, shadow } from "./lib";
import type { TDir } from "./characters";

type TPose = { bob: number; swing: number };
const POSES: TPose[] = [
	{ bob: 0, swing: 0 },
	{ bob: -4, swing: 1 },
	{ bob: -2, swing: -1 },
];

const EYE = "#2d1f18";
const eye = (x: number, y: number, r = 3) => ellipse(x, y, r, r * 1.3, EYE) + circle(x - r * 0.35, y - r * 0.45, r * 0.4, "#ffffff");
/** A leg hanging from a hip at (x, y), swung by `rot` degrees */
const leg = (p: Pic, x: number, y: number, w: number, h: number, colour: string, hoof: string, rot: number) =>
	group(rect(x - w / 2, y, w, h, p.shade(colour, 0.2), { ol: true, r: w / 2 }) + ellipse(x, y + h - 1, w / 2 + 1, 3, hoof, { ol: true }), `rotate(${rot} ${x} ${y})`);

type TDraw = (p: Pic, pose: TPose) => void;
interface TAnimal {
	side: TDraw;
	front: TDraw;
	back: TDraw;
}

const FUR = "#cdb79c";
const rabbit: TAnimal = {
	side: (p, { bob, swing }) => {
		p.add(shadow(66, 112, 26, 6));
		const hind = swing ? 12 : 0;
		p.add(ellipse(80 + hind, 109, 11, 4.5, darken(FUR, 0.1), { ol: true }), ellipse(50 - hind / 2, 109 + bob / 2, 5, 4, darken(FUR, 0.1), { ol: true }));
		const g =
			ellipse(70, 92, 22, 16, p.shade(FUR, 0.2), { ol: true }) +
			circle(84, 96, 13, p.shade(FUR, 0.2), { ol: true }) +
			circle(94, 88, 6, "#ffffff", { ol: true }) +
			ellipse(66, 100, 12, 6, lighten(FUR, 0.5), { op: 0.7 }) +
			group(ellipse(0, 0, 5.5, 15, p.shade(FUR, 0.2), { ol: true }) + ellipse(0, 1, 2.5, 10, "#eaa3ae"), "translate(56 62) rotate(18)") +
			circle(48, 80, 13, p.shade(FUR, 0.2), { ol: true }) +
			eye(44, 77) +
			circle(36, 82, 2.5, "#e58a96");
		p.add(group(g, `translate(0 ${bob * 2})`));
	},
	front: (p, { bob, swing }) => {
		p.add(shadow(64, 112, 22, 6));
		p.add(ellipse(55, 109 + (swing > 0 ? bob : 0), 6, 4, darken(FUR, 0.1), { ol: true }), ellipse(73, 109 + (swing < 0 ? bob : 0), 6, 4, darken(FUR, 0.1), { ol: true }));
		let g = ellipse(64, 96, 19, 15, p.shade(FUR, 0.2), { ol: true }) + ellipse(64, 99, 10, 9, lighten(FUR, 0.55));
		for (const x of [56, 72]) g += group(ellipse(0, 0, 5.5, 15, p.shade(FUR, 0.2), { ol: true }) + ellipse(0, 1, 2.5, 10, "#eaa3ae"), `translate(${x} 62) rotate(${x < 64 ? -8 : 8})`);
		g += circle(64, 79, 14, p.shade(FUR, 0.2), { ol: true }) + eye(58, 78) + eye(70, 78) + path("M61 85h6l-3 3z", "#e58a96");
		p.add(group(g, `translate(0 ${bob * 2})`));
	},
	back: (p, { bob }) => {
		p.add(shadow(64, 112, 22, 6));
		let g = ellipse(64, 95, 20, 16, p.shade(FUR, 0.2), { ol: true });
		g += circle(64, 77, 13, p.shade(FUR, 0.2), { ol: true });
		for (const x of [57, 71]) g += group(ellipse(0, 0, 5.5, 15, p.shade(FUR, 0.2), { ol: true }), `translate(${x} 60) rotate(${x < 64 ? -8 : 8})`);
		g += circle(64, 104, 6.5, "#ffffff", { ol: true });
		p.add(group(g, `translate(0 ${bob * 2})`));
	},
};

const HIDE = "#b8794a";
const ANTLER = "#eadbb8";
const antlers = (x: number, y: number, flip: number) =>
	[line(`M${x} ${y}l${-6 * flip} -16l${-6 * flip} -6M${x - 6 * flip} ${y - 16}l${4 * flip} -10`, "#3b2a20", 9), line(`M${x} ${y}l${-6 * flip} -16l${-6 * flip} -6M${x - 6 * flip} ${y - 16}l${4 * flip} -10`, ANTLER, 4.5)].join("");
const deer: TAnimal = {
	side: (p, { bob, swing }) => {
		p.add(shadow(68, 116, 38, 7));
		const s = swing * 16;
		p.add(leg(p, 88, 84, 8, 30, darken(HIDE, 0.2), "#3b2a20", -s), leg(p, 50, 84, 8, 30, darken(HIDE, 0.2), "#3b2a20", s));
		let g = ellipse(70, 80, 32, 17, p.shade(HIDE, 0.2), { ol: true });
		g += path("M46 76q-8 -16 -6 -28l14 -2q2 14 10 26z", p.shade(HIDE, 0.2), { ol: true });
		g += ellipse(70, 88, 22, 6, lighten(HIDE, 0.5), { op: 0.7 });
		for (const [x, y] of [[66, 72], [78, 70], [86, 78], [72, 80]] as const) g += circle(x, y, 2.2, "#f6e7cf");
		g += circle(101, 72, 5, "#ffffff", { ol: true });
		g += antlers(48, 40, -1) + antlers(40, 40, 1);
		g += group(ellipse(0, 0, 4.5, 10, p.shade(HIDE, 0.2), { ol: true }), "translate(54 42) rotate(55)");
		g += ellipse(40, 50, 14, 10, p.shade(HIDE, 0.2), { ol: true }) + ellipse(29, 54, 6, 5, darken(HIDE, 0.45)) + eye(40, 47, 2.6);
		p.add(leg(p, 92, 84, 8, 30, HIDE, "#3b2a20", s), leg(p, 46, 84, 8, 30, HIDE, "#3b2a20", -s));
		p.add(group(g, `translate(0 ${bob})`));
	},
	front: (p, { bob, swing }) => {
		p.add(shadow(64, 116, 28, 7));
		p.add(leg(p, 54, 86, 9, 28 - (swing > 0 ? 4 : 0), HIDE, "#3b2a20", 0), leg(p, 74, 86, 9, 28 - (swing < 0 ? 4 : 0), HIDE, "#3b2a20", 0));
		let g = ellipse(64, 80, 22, 18, p.shade(HIDE, 0.2), { ol: true }) + ellipse(64, 86, 11, 10, lighten(HIDE, 0.55));
		g += antlers(56, 38, 1) + antlers(72, 38, -1);
		g += group(ellipse(0, 0, 4.5, 10, p.shade(HIDE, 0.2), { ol: true }), "translate(46 44) rotate(-60)") + group(ellipse(0, 0, 4.5, 10, p.shade(HIDE, 0.2), { ol: true }), "translate(82 44) rotate(60)");
		g += ellipse(64, 52, 13, 15, p.shade(HIDE, 0.2), { ol: true }) + ellipse(64, 62, 7, 5, darken(HIDE, 0.45)) + eye(58, 50, 2.6) + eye(70, 50, 2.6);
		p.add(group(g, `translate(0 ${bob})`));
	},
	back: (p, { bob, swing }) => {
		p.add(shadow(64, 116, 28, 7));
		p.add(leg(p, 54, 86, 9, 28 - (swing > 0 ? 4 : 0), HIDE, "#3b2a20", 0), leg(p, 74, 86, 9, 28 - (swing < 0 ? 4 : 0), HIDE, "#3b2a20", 0));
		let g = ellipse(64, 54, 12, 13, p.shade(HIDE, 0.2), { ol: true }) + antlers(56, 42, 1) + antlers(72, 42, -1);
		g += group(ellipse(0, 0, 4.5, 10, p.shade(HIDE, 0.2), { ol: true }), "translate(48 48) rotate(-60)") + group(ellipse(0, 0, 4.5, 10, p.shade(HIDE, 0.2), { ol: true }), "translate(80 48) rotate(60)");
		g += ellipse(64, 80, 23, 20, p.shade(HIDE, 0.2), { ol: true }) + ellipse(64, 88, 9, 8, "#f6e7cf") + circle(64, 80, 5, "#ffffff", { ol: true });
		p.add(group(g, `translate(0 ${bob})`));
	},
};

const DUCK = "#f6f1e4";
const HEAD = "#2f8a4a";
const BILL = "#f39c12";
const duck: TAnimal = {
	side: (p, { bob, swing }) => {
		p.add(shadow(66, 112, 26, 6));
		p.add(ellipse(60 - swing * 4, 110, 6, 3, BILL, { ol: true }), ellipse(74 + swing * 4, 110, 6, 3, BILL, { ol: true }));
		let g = path("M44 92q0 -18 24 -18q22 0 30 6l8 -6q2 12 -6 20q-8 14 -30 14q-26 0 -26 -16z", p.shade(DUCK, 0.18), { ol: true });
		g += ellipse(76, 90, 16, 9, "#ddd5c2", { ol: true });
		g += rect(40, 78, 12, 12, "#ffffff", { r: 4 });
		g += circle(46, 68, 13, p.shade(HEAD, 0.25), { ol: true }) + ellipse(31, 71, 9, 4.5, BILL, { ol: true }) + eye(44, 65, 2.5);
		p.add(group(g, `translate(0 ${bob / 2}) rotate(${swing * 4} 64 104)`));
	},
	front: (p, { bob, swing }) => {
		p.add(shadow(64, 112, 22, 6));
		p.add(ellipse(56, 110, 6, 3, BILL, { ol: true }), ellipse(72, 110, 6, 3, BILL, { ol: true }));
		let g = ellipse(64, 94, 21, 17, p.shade(DUCK, 0.18), { ol: true });
		g += rect(54, 78, 20, 6, "#ffffff", { r: 3 });
		g += circle(64, 68, 13, p.shade(HEAD, 0.25), { ol: true }) + ellipse(64, 77, 8, 4.5, BILL, { ol: true }) + eye(58, 66, 2.5) + eye(70, 66, 2.5);
		p.add(group(g, `translate(0 ${bob / 2}) rotate(${swing * 4} 64 104)`));
	},
	back: (p, { bob, swing }) => {
		p.add(shadow(64, 112, 22, 6));
		p.add(ellipse(56, 110, 6, 3, BILL, { ol: true }), ellipse(72, 110, 6, 3, BILL, { ol: true }));
		let g = circle(64, 66, 12, p.shade(HEAD, 0.25), { ol: true });
		g += ellipse(64, 94, 21, 17, p.shade(DUCK, 0.18), { ol: true });
		g += ellipse(54, 92, 9, 13, "#ddd5c2", { ol: true }) + ellipse(74, 92, 9, 13, "#ddd5c2", { ol: true }) + path("M58 106l6 8l6 -8z", "#ddd5c2", { ol: true });
		p.add(group(g, `translate(0 ${bob / 2}) rotate(${swing * 4} 64 104)`));
	},
};

const BOAR = "#6e4c37";
const BRISTLE = "#3f2a1d";
const SNOUT = "#c98d7a";
const tusk = (x: number, y: number, flip: number) => path(`M${x} ${y}q${-6 * flip} -2 ${-7 * flip} -9q${3 * flip} 4 ${9 * flip} 5z`, "#fbf4e2", { ol: true, extra: { "stroke-width": 2 } });
const boar: TAnimal = {
	side: (p, { bob, swing }) => {
		p.add(shadow(66, 114, 38, 7));
		const s = swing * 14;
		p.add(leg(p, 86, 96, 10, 18, darken(BOAR, 0.25), BRISTLE, -s), leg(p, 50, 96, 10, 18, darken(BOAR, 0.25), BRISTLE, s));
		let g = ellipse(70, 86, 33, 21, p.shade(BOAR, 0.22), { ol: true });
		g += path("M46 68q24 -10 54 2q-24 -2 -54 4z", BRISTLE, { ol: true });
		g += line("M102 82q8 -2 6 -8q-4 -2 -4 4", BRISTLE, 3);
		g += path("M44 72l2 -12l10 10z", p.shade(BOAR, 0.22), { ol: true });
		g += ellipse(38, 88, 17, 14, p.shade(BOAR, 0.22), { ol: true }) + ellipse(23, 92, 6, 8, SNOUT, { ol: true }) + circle(21, 90, 1.4, BRISTLE) + circle(21, 95, 1.4, BRISTLE);
		g += tusk(30, 100, 1) + eye(36, 84, 2.4);
		p.add(leg(p, 90, 96, 10, 18, BOAR, BRISTLE, s), leg(p, 46, 96, 10, 18, BOAR, BRISTLE, -s));
		p.add(group(g, `translate(0 ${bob / 2})`));
	},
	front: (p, { bob, swing }) => {
		p.add(shadow(64, 114, 30, 7));
		p.add(leg(p, 52, 96, 11, 18 - (swing > 0 ? 3 : 0), BOAR, BRISTLE, 0), leg(p, 76, 96, 11, 18 - (swing < 0 ? 3 : 0), BOAR, BRISTLE, 0));
		let g = ellipse(64, 82, 28, 21, p.shade(BOAR, 0.22), { ol: true });
		g += path("M48 74l-2 -14l12 8z", p.shade(BOAR, 0.22), { ol: true }) + path("M80 74l2 -14l-12 8z", p.shade(BOAR, 0.22), { ol: true });
		g += ellipse(64, 88, 18, 15, p.shade(lighten(BOAR, 0.08), 0.22), { ol: true }) + ellipse(64, 96, 10, 7, SNOUT, { ol: true });
		g += circle(60, 96, 1.6, BRISTLE) + circle(68, 96, 1.6, BRISTLE) + tusk(54, 100, -1) + tusk(74, 100, 1) + eye(57, 84, 2.4) + eye(71, 84, 2.4);
		p.add(group(g, `translate(0 ${bob / 2})`));
	},
	back: (p, { bob, swing }) => {
		p.add(shadow(64, 114, 30, 7));
		p.add(leg(p, 52, 96, 11, 18 - (swing > 0 ? 3 : 0), BOAR, BRISTLE, 0), leg(p, 76, 96, 11, 18 - (swing < 0 ? 3 : 0), BOAR, BRISTLE, 0));
		let g = path("M50 70l-2 -14l12 8z", p.shade(BOAR, 0.22), { ol: true }) + path("M78 70l2 -14l-12 8z", p.shade(BOAR, 0.22), { ol: true });
		g += ellipse(64, 84, 29, 23, p.shade(BOAR, 0.22), { ol: true }) + path("M60 62q4 22 0 44q8 -22 8 -44z", BRISTLE);
		g += line("M64 104q6 6 2 10q-4 0 -2 -4", BRISTLE, 3);
		p.add(group(g, `translate(0 ${bob / 2})`));
	},
};

export const ANIMALS: Record<string, TAnimal> = { rabbit, deer, duck, boar };
export const ANIMAL_FRAMES = POSES.length;

export function animal(kind: string, dir: TDir, frame: number): string {
	const a = ANIMALS[kind]!;
	const p = new Pic();
	const pose = POSES[frame]!;
	if (dir === "d") a.front(p, pose);
	else if (dir === "u") a.back(p, pose);
	else a.side(p, pose);
	return p.svg(dir === "r");
}
