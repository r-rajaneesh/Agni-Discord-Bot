// Real-money items, paid by a Razorpay link the bot DMs. Gems are earned in game and never sold here.
import { PRODUCTS } from "@game/data/products";
import type { TClientMsg } from "@game/protocol";
import { button, el, Panel } from "./dom";

const inr = (digits: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Rupees from paise: "₹199", or "₹49.50" when there are paise */
export const formatINR = (paise: number) => inr(paise % 100 ? 2 : 0).format(paise / 100);

export class StorePanel extends Panel {
	private note = el("p", "note");

	constructor(private send: (m: TClientMsg) => void) {
		super("Store", "panel-store");
		const list = el("div", "list");
		for (const p of PRODUCTS) {
			const card = el("div", "product");
			const info = el("div", "product-info");
			info.append(el("strong", "", `${p.emoji} ${p.name}`), el("span", "muted", p.description));
			card.append(
				info,
				el("span", "row-price", formatINR(p.priceINR)),
				button("Buy", () => {
					this.send({ t: "buyProduct", productId: p.id });
					this.note.textContent = "Check your Discord DMs to pay";
				}),
			);
			list.append(card);
		}
		this.body.append(list, this.note, el("p", "muted small", "Gems can't be bought. Earn them by playing."));
	}

	override show(): void {
		this.note.textContent = "";
		super.show();
	}
}
