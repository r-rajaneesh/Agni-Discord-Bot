// Small DOM helpers for the overlays. Text always goes in through textContent, never innerHTML.
import { ITEMS } from "@game/data/items";
import itemRects from "../assets/items.frames.json";
import { ITEM_FRAMES } from "../assets/manifest";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text !== undefined) e.textContent = text;
	return e;
}

export function button(text: string, onClick: () => void, cls = "btn"): HTMLButtonElement {
	const b = el("button", cls, text);
	b.type = "button";
	b.addEventListener("click", onClick);
	return b;
}

/** A centred dialog with a title and a close button. GameUI keeps at most one open. */
export class Panel {
	readonly root = el("div", "panel");
	readonly body = el("div", "panel-body");
	onClose: () => void = () => {};

	constructor(title: string, cls: string) {
		this.root.classList.add(cls);
		this.root.hidden = true;
		this.root.setAttribute("role", "dialog");
		const head = el("div", "panel-head");
		head.append(el("h2", "", title), button("✕", () => this.onClose(), "btn btn-close"));
		this.root.append(head, this.body);
	}

	get open(): boolean {
		return !this.root.hidden;
	}

	show(): void {
		this.root.hidden = false;
	}

	hide(): void {
		this.root.hidden = true;
	}
}

// Frame rects of items.png, written by scripts/build-atlas.ts beside the atlas
type TRects = { size: { w: number; h: number }; frames: Record<string, { x: number; y: number; w: number; h: number }> };
const SHEET = itemRects as TRects;

/**
 * An item's icon from the items atlas, as a span whose background is that frame. Percentages keep it right at
 * any size the CSS gives the span. An unknown item shows ❔.
 */
export function itemIcon(id: string, cls: string): HTMLSpanElement {
	const f = ITEMS[id] ? SHEET.frames[ITEM_FRAMES[id]!.frame] : undefined;
	if (!f) return el("span", cls, "❔");
	const { w, h } = SHEET.size;
	const s = el("span", `${cls} item-icon`);
	s.style.backgroundImage = "url(assets/items.png)";
	s.style.backgroundSize = `${(w / f.w) * 100}% ${(h / f.h) * 100}%`;
	s.style.backgroundPosition = `${(f.x / (w - f.w)) * 100}% ${(f.y / (h - f.h)) * 100}%`;
	s.setAttribute("aria-hidden", "true");
	return s;
}
