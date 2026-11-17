// Shared drawing kit for the original vector art: one palette, one light direction (top-left), one outline weight
export const S = 128; // pixels per tile in the atlases
export const OL = "#3b2a20"; // outline colour: a warm dark brown, never pure black
export const OW = 4; // outline width at 128 px per tile, 1.5 px on screen

type TAttrs = Record<string, string | number | undefined>;

export function tag(name: string, attrs: TAttrs, inner?: string): string {
	const a = Object.entries(attrs)
		.filter(([, v]) => v !== undefined)
		.map(([k, v]) => ` ${k}="${v}"`)
		.join("");
	return inner === undefined ? `<${name}${a}/>` : `<${name}${a}>${inner}</${name}>`;
}

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (n: number[]) => `#${n.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;

export function mix(a: string, b: string, t: number): string {
	const x = hex(a);
	const y = hex(b);
	return toHex(x.map((v, i) => v + (y[i]! - v) * t));
}
// Light is a warm cream and shadow a warm brown, so shading never goes grey
export const lighten = (c: string, t: number) => mix(c, "#fff8e8", t);
export const darken = (c: string, t: number) => mix(c, "#2a1a10", t);

/** Seeded PRNG (mulberry32), so the art comes out the same every build */
export function rng(seed: number): () => number {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** One SVG picture. Gradients and clips get ids that are unique within the file. */
export class Pic {
	private defs: string[] = [];
	private parts: string[] = [];
	private n = 0;

	constructor(
		readonly w = S,
		readonly h = S,
	) {}

	add(...s: string[]): this {
		this.parts.push(...s);
		return this;
	}

	private id(p: string): string {
		return `${p}${this.n++}`;
	}

	/** Soft top-left light: a diagonal gradient from a lighter to a darker shade of the base colour */
	shade(base: string, amt = 0.22): string {
		const id = this.id("g");
		this.defs.push(
			tag("linearGradient", { id, x1: 0.2, y1: 0.05, x2: 0.8, y2: 1 }, tag("stop", { offset: 0, "stop-color": lighten(base, amt) }) + tag("stop", { offset: 1, "stop-color": darken(base, amt) })),
		);
		return `url(#${id})`;
	}

	/** A plain top-left to bottom-right gradient between two colours */
	linear(from: string, to: string): string {
		const id = this.id("l");
		this.defs.push(tag("linearGradient", { id, x1: 0.2, y1: 0.05, x2: 0.8, y2: 1 }, tag("stop", { offset: 0, "stop-color": from }) + tag("stop", { offset: 1, "stop-color": to })));
		return `url(#${id})`;
	}

	radial(stops: [number, string, number?][], cx = 0.4, cy = 0.35, r = 0.7): string {
		const id = this.id("r");
		this.defs.push(tag("radialGradient", { id, cx, cy, r }, stops.map(([o, c, a]) => tag("stop", { offset: o, "stop-color": c, "stop-opacity": a ?? 1 })).join("")));
		return `url(#${id})`;
	}

	/** A clip path from shapes; returns the attribute value */
	clip(shapes: string): string {
		const id = this.id("c");
		this.defs.push(tag("clipPath", { id }, shapes));
		return `url(#${id})`;
	}

	svg(mirror = false): string {
		const body = mirror ? tag("g", { transform: `translate(${this.w} 0) scale(-1 1)` }, this.parts.join("")) : this.parts.join("");
		return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}" viewBox="0 0 ${this.w} ${this.h}">${tag("defs", {}, this.defs.join(""))}${body}</svg>\n`;
	}
}

// Plain shapes. `ol` adds the shared outline.
type TOpt = { ol?: boolean; op?: number; extra?: TAttrs };
const style = (fill: string, o: TOpt = {}): TAttrs => ({
	fill,
	stroke: o.ol ? OL : undefined,
	"stroke-width": o.ol ? OW : undefined,
	"stroke-linejoin": o.ol ? "round" : undefined,
	opacity: o.op,
	...o.extra,
});
export const rect = (x: number, y: number, w: number, h: number, fill: string, o: TOpt & { r?: number } = {}) => tag("rect", { x, y, width: w, height: h, rx: o.r, ...style(fill, o) });
export const circle = (cx: number, cy: number, r: number, fill: string, o: TOpt = {}) => tag("circle", { cx, cy, r, ...style(fill, o) });
export const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: string, o: TOpt = {}) => tag("ellipse", { cx, cy, rx, ry, ...style(fill, o) });
export const path = (d: string, fill: string, o: TOpt = {}) => tag("path", { d, ...style(fill, o) });
/** An open stroke, rounded at the ends */
export const line = (d: string, colour: string, width = OW, op?: number) =>
	tag("path", { d, fill: "none", stroke: colour, "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: op });
export const group = (inner: string, transform?: string, op?: number, clip?: string) => tag("g", { transform, opacity: op, "clip-path": clip }, inner);

/** The soft contact shadow every object sits on */
export const shadow = (cx: number, cy: number, rx: number, ry: number) => ellipse(cx, cy, rx, ry, "#1d140c", { op: 0.2 });

/**
 * Several shapes drawn as one silhouette with a single outline: every shape is stroked at twice the width
 * first, then all fills go on top, so inner seams vanish.
 */
export function blob(shapes: ((fill: string, o?: TOpt) => string)[], fill: string): string {
	const back = shapes.map((s) => s(OL, { extra: { stroke: OL, "stroke-width": OW * 2, "stroke-linejoin": "round" } })).join("");
	return back + shapes.map((s) => s(fill)).join("");
}
