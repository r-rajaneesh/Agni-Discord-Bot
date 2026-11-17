// Server messages, stacked top-centre for 3 s each
import { el } from "./dom";

export const TOAST_MS = 3000;
const MAX_TOASTS = 4;

export class Toasts {
	private root = el("div", "toasts");

	constructor(parent: HTMLElement) {
		this.root.setAttribute("aria-live", "polite");
		parent.append(this.root);
	}

	show(msg: string, ok: boolean): void {
		const t = el("div", ok ? "toast" : "toast toast-bad", msg);
		this.root.append(t);
		while (this.root.children.length > MAX_TOASTS) this.root.firstElementChild!.remove();
		setTimeout(() => t.remove(), TOAST_MS);
	}
}
