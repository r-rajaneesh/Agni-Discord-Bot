// The farmer, in two layers per frame: `body` is the shirt in greys (the game tints it with the player's
// colour) and `detail` is everything that keeps its own colours. Frames: 0 standing, 1 and 2 mid-step.
import { Pic, circle, darken, ellipse, group, line, path, rect } from "./lib";

export type TDir = "u" | "d" | "l" | "r";
const SKIN = "#f3c39b";
const HAIR = "#6b3e26";
const PANTS = "#4d5f80";
const SHOE = "#5a3b2a";
const SHIRT_HI = "#ffffff";
const SHIRT_LO = "#b9b9b9";

interface TPose {
	bob: number; // body lift
	legs: [number, number]; // per leg: lift (front/back views) or swing in degrees (side view)
	arm: number; // arm swing
}
const POSES: TPose[] = [
	{ bob: 0, legs: [0, 0], arm: 0 },
	{ bob: -3, legs: [5, 0], arm: 1 },
	{ bob: -3, legs: [0, 5], arm: -1 },
];

function legFront(p: Pic, x: number, lift: number): string {
	return rect(x, 92 - lift, 12, 22, p.shade(PANTS, 0.2), { ol: true, r: 4 }) + ellipse(x + 6, 115 - lift, 8, 5, SHOE, { ol: true });
}

function headFront(p: Pic, face: boolean): string {
	let s = circle(37, 46, 6, SKIN, { ol: true }) + circle(91, 46, 6, SKIN, { ol: true });
	s += ellipse(64, 42, 28, 26, p.shade(SKIN, 0.15), { ol: true });
	if (face) {
		s += path(`M36 42Q36 12 64 12Q92 12 92 42Q86 30 74 28Q66 36 52 29Q42 33 36 42z`, p.shade(HAIR, 0.25), { ol: true });
		for (const x of [54, 74]) s += ellipse(x, 47, 3.2, 4.6, "#2d1f18") + circle(x - 1, 45.5, 1.3, "#ffffff");
		s += ellipse(47, 55, 5, 3, "#ff8f8f", { op: 0.35 }) + ellipse(81, 55, 5, 3, "#ff8f8f", { op: 0.35 });
		s += line(`M60 57q4 3 8 0`, darken(SKIN, 0.5), 2.5);
	} else {
		s += path(`M36 44Q34 12 64 13Q94 12 92 44Q92 62 64 64Q36 62 36 44z`, p.shade(HAIR, 0.25), { ol: true });
		s += line(`M52 24q12 -6 24 0`, "#8a5536", 3, 0.6);
	}
	return s;
}

/** Front (d) or back (u) view */
function frontBack(dir: "u" | "d", pose: TPose, layer: "body" | "detail"): Pic {
	const p = new Pic();
	const b = pose.bob;
	const armY = (side: number) => pose.arm * side * 3;
	if (layer === "body") {
		const fill = p.linear(SHIRT_HI, SHIRT_LO);
		p.add(rect(42, 60 + b, 44, 36, fill, { ol: true, r: 10 }));
		p.add(rect(31, 62 + b + armY(1), 13, 28, fill, { ol: true, r: 6 }), rect(84, 62 + b + armY(-1), 13, 28, fill, { ol: true, r: 6 }));
		if (dir === "d") p.add(line(`M56 ${62 + b}l8 9l8 -9`, "#8f8f8f", 3));
		p.add(line(`M46 ${90 + b}h36`, "#9a9a9a", 2.5, 0.8));
		return p;
	}
	p.add(legFront(p, 50, pose.legs[0]), legFront(p, 66, pose.legs[1]));
	p.add(circle(37.5, 92 + b + armY(1), 6, SKIN, { ol: true }), circle(90.5, 92 + b + armY(-1), 6, SKIN, { ol: true }));
	p.add(group(headFront(p, dir === "d"), `translate(0 ${b})`));
	return p;
}

/** Side view facing left; facing right is the mirror image */
function side(pose: TPose, layer: "body" | "detail"): Pic {
	const p = new Pic();
	const b = pose.bob;
	const swing = pose.legs[0] ? 18 : pose.legs[1] ? -18 : 0;
	const arm = `rotate(${pose.arm * 22} 64 ${66 + b})`;
	if (layer === "body") {
		const fill = p.linear(SHIRT_HI, SHIRT_LO);
		p.add(rect(47, 60 + b, 34, 36, fill, { ol: true, r: 10 }));
		p.add(line(`M50 ${90 + b}h28`, "#9a9a9a", 2.5, 0.8));
		p.add(group(rect(57, 62 + b, 13, 28, fill, { ol: true, r: 6 }), arm));
		return p;
	}
	const leg = (dx: number, rot: number, shade: number) =>
		group(rect(58 + dx, 92, 12, 22, p.shade(darken(PANTS, shade), 0.2), { ol: true, r: 4 }) + ellipse(60 + dx, 115, 9, 5, darken(SHOE, shade), { ol: true }), `rotate(${rot} ${64 + dx} 94)`);
	p.add(leg(4, -swing, 0.2), leg(-2, swing, 0));
	let head = ellipse(62, 42, 26, 26, p.shade(SKIN, 0.15), { ol: true });
	head += path("M88 44Q92 14 62 13Q40 13 38 32Q50 30 62 34Q66 44 72 50Q82 52 88 44z", p.shade(HAIR, 0.25), { ol: true });
	head += circle(74, 45, 6, SKIN, { ol: true });
	head += ellipse(47, 47, 3.2, 4.6, "#2d1f18") + circle(46, 45.5, 1.3, "#ffffff") + ellipse(46, 56, 5, 3, "#ff8f8f", { op: 0.35 });
	head += path("M37 46q-4 4 0 7", "none", { extra: { stroke: darken(SKIN, 0.4), "stroke-width": 2.5, "stroke-linecap": "round" } });
	p.add(group(head, `translate(0 ${b})`));
	p.add(group(circle(63.5, 92 + b, 6, SKIN, { ol: true }), arm));
	return p;
}

export function character(dir: TDir, frame: number, layer: "body" | "detail"): string {
	const pose = POSES[frame]!;
	if (dir === "u" || dir === "d") return frontBack(dir, pose, layer).svg();
	return side(pose, layer).svg(dir === "r");
}

export const CHARACTER_FRAMES = POSES.length;

/** A small gold crown for Farm Pass holders, worn above the name */
export function crown(): string {
	const p = new Pic(64, 40);
	p.add(path("M8 34L6 10L20 22L32 6L44 22L58 10L56 34z", p.shade("#f2c14e", 0.25), { ol: true }));
	p.add(rect(8, 28, 48, 7, "#d9a520", { ol: true, r: 2 }));
	p.add(circle(32, 20, 4, "#e74c3c", { ol: true }), circle(18, 26, 2.5, "#3fa7d6"), circle(46, 26, 2.5, "#3fa7d6"));
	p.add(line("M14 14l2 12", "#fff3c4", 2.5, 0.8));
	return p.svg();
}

/** The soft ground shadow under a player */
export function playerShadow(): string {
	return new Pic(64, 24).add(ellipse(32, 12, 28, 9, "#1d140c", { op: 0.25 })).svg();
}

