// Everything you carry. Seeds can be equipped from here; tools are always at hand on the hotbar.
import { ITEMS, type TItemCategory } from "@game/data/items";
import type { ClientState } from "../state";
import { el, itemIcon, Panel } from "./dom";

const ORDER: TItemCategory[] = ["seed", "crop", "resource", "tool"];

export class InventoryPanel extends Panel {
	constructor(
		private state: ClientState,
		private equip: (item: string) => void,
	) {
		super("Inventory", "panel-inventory");
	}

	render(): void {
		const inv = this.state.wallet.inventory;
		const ids = Object.keys(inv)
			.filter((id) => (inv[id] ?? 0) > 0)
			.sort((a, b) => ORDER.indexOf(ITEMS[a]?.category ?? "resource") - ORDER.indexOf(ITEMS[b]?.category ?? "resource") || a.localeCompare(b));
		if (!ids.length) {
			this.body.replaceChildren(el("p", "muted", "Your bag is empty."));
			return;
		}
		const grid = el("div", "inv-grid");
		for (const id of ids) {
			const def = ITEMS[id];
			const canEquip = def?.category === "seed";
			const cell = el(canEquip ? "button" : "div", canEquip ? "inv-cell inv-equip" : "inv-cell");
			if (cell instanceof HTMLButtonElement) {
				cell.type = "button";
				cell.title = `Equip ${def!.name}`;
				cell.addEventListener("click", () => this.equip(id));
			}
			cell.append(el("span", "inv-icon", itemIcon(id)), el("span", "inv-name", def?.name ?? id), el("span", "inv-count", `×${inv[id]}`));
			grid.append(cell);
		}
		this.body.replaceChildren(grid);
	}
}
