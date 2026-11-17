// Small DOM helpers for the overlays. Text always goes in through textContent, never innerHTML.
import { ITEMS } from "@game/data/items";

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

/** Emoji for an item; seeds show the crop they grow, since every seed bag is 🌱 */
export function itemIcon(id: string): string {
	const def = ITEMS[id];
	if (!def) return "❔";
	return (def.cropId && ITEMS[def.cropId]?.emoji) || def.emoji;
}
