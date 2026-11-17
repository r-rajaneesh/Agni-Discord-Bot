// The General Store: opens on menu "shop". Prices come from the welcome snapshot; the server has the final say.
import { ITEMS } from "@game/data/items";
import type { TClientMsg } from "@game/protocol";
import type { ClientState } from "../state";
import { button, el, itemIcon, Panel } from "./dom";

export class ShopPanel extends Panel {
	constructor(
		private state: ClientState,
		private send: (m: TClientMsg) => void,
	) {
		super("General Store", "panel-shop");
	}

	render(): void {
		const { prices, wallet } = this.state;
		const inv = wallet.inventory;
		const row = (id: string, price: string, ...actions: HTMLButtonElement[]) => {
			const r = el("div", "row");
			const name = el("span", "row-name");
			name.append(itemIcon(id, "row-icon"), el("span", "", ITEMS[id]?.name ?? id));
			const acts = el("span", "row-actions");
			acts.append(...actions);
			r.append(name, el("span", "row-price", price), acts);
			return r;
		};

		const buy = el("div", "list");
		for (const def of Object.values(ITEMS)) {
			const p = prices[def.id];
			if (def.category !== "seed" || !p) continue;
			buy.append(
				row(
					def.id,
					`🪙 ${p.buy}`,
					button("Buy 1", () => this.send({ t: "buy", item: def.id, qty: 1 })),
					button("Buy 10", () => this.send({ t: "buy", item: def.id, qty: 10 })),
				),
			);
		}

		const sell = el("div", "list");
		for (const [id, n] of Object.entries(inv)) {
			const p = prices[id];
			if (!(n > 0) || !p || !ITEMS[id]?.tradeable) continue;
			sell.append(
				row(
					id,
					`🪙 ${p.sell}`,
					button("Sell 1", () => this.send({ t: "sell", item: id, qty: 1 })),
					button(`Sell all (${n})`, () => this.send({ t: "sell", item: id, qty: "all" })),
				),
			);
		}
		if (!sell.children.length) sell.append(el("p", "muted", "Nothing to sell yet."));

		this.body.replaceChildren(el("h3", "", "Buy"), buy, el("h3", "", "Sell"), sell);
	}
}
