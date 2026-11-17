// Bottom bar: the tools, then every seed you hold. 1–9 or a tap equips.
import { ITEMS, TOOL_IDS } from "@game/data/items";
import type { ClientState } from "../state";
import { el, itemIcon } from "./dom";

/** Tools first, then held seeds in catalogue order */
export function hotbarItems(inventory: Record<string, number>): string[] {
	const seeds = Object.values(ITEMS)
		.filter((i) => i.category === "seed" && (inventory[i.id] ?? 0) > 0)
		.map((i) => i.id);
	return [...TOOL_IDS, ...seeds];
}

export class Hotbar {
	private root = el("div", "hotbar");
	private items: string[] = [];
	private last = "";

	constructor(
		parent: HTMLElement,
		private state: ClientState,
		private equip: (item: string) => void,
	) {
		parent.append(this.root);
	}

	/** Equips the item in slot i (0-based), if there is one */
	slot(i: number): void {
		const item = this.items[i];
		if (item) this.equip(item);
	}

	update(): void {
		const inv = this.state.wallet.inventory;
		const items = hotbarItems(inv);
		const equipped = this.state.you?.equipped ?? "";
		const key = `${equipped}|${items.map((id) => `${id}:${inv[id] ?? ""}`).join(",")}`;
		if (key === this.last) return;
		this.last = key;
		this.items = items;
		this.root.replaceChildren(
			...items.map((id, i) => {
				const def = ITEMS[id];
				const b = el("button", id === equipped ? "slot slot-on" : "slot");
				b.type = "button";
				b.title = `${def?.name ?? id}${i < 9 ? ` (${i + 1})` : ""}`;
				b.setAttribute("aria-label", def?.name ?? id);
				b.setAttribute("aria-pressed", String(id === equipped));
				b.append(el("span", "slot-icon", itemIcon(id)));
				if (i < 9) b.append(el("span", "slot-key", String(i + 1)));
				if (def?.category === "seed") b.append(el("span", "slot-count", String(inv[id] ?? 0)));
				b.addEventListener("click", () => this.equip(id));
				return b;
			}),
		);
	}
}
