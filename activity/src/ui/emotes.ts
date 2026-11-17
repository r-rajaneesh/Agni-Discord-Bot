// Emote wheel: the free emotes first, then the premium ones. A locked one shows its gem price,
// a "Buy with gems" button and, when a real-money pack has it, "Get pack".
import { EMOTES, FREE_EMOTES, type TEmote } from "@game/data/emotes";
import { packWith } from "@game/data/products";
import type { TClientMsg } from "@game/protocol";
import type { ClientState } from "../state";
import { button, el, Panel } from "./dom";
import { formatINR } from "./store";

const FREE = new Set(FREE_EMOTES);
const PREMIUM = Object.values(EMOTES).filter((e) => !FREE.has(e.id));

export class EmotePanel extends Panel {
	private free = el("div", "emote-grid");
	private premium = el("div", "emote-grid");
	private note = el("p", "note");

	constructor(
		private state: ClientState,
		private send: (m: TClientMsg) => void,
	) {
		super("Emotes", "panel-emotes");
		this.body.append(el("h3", "", "Free"), this.free, el("h3", "", "Premium"), this.premium, this.note);
	}

	override show(): void {
		this.note.textContent = "";
		super.show();
	}

	/** Builds the grid from what you own and your gems */
	render(): void {
		const { owned, wallet } = this.state;
		this.free.replaceChildren(...FREE_EMOTES.flatMap((id) => (EMOTES[id] ? [this.play(EMOTES[id])] : [])));
		this.premium.replaceChildren(...PREMIUM.map((e) => (owned.has(e.id) ? this.play(e) : this.locked(e, wallet.gems))));
	}

	// An emote you can use: one tap plays it and closes the wheel
	private play(e: TEmote): HTMLElement {
		const b = el("button", "emote");
		b.type = "button";
		b.title = e.name;
		b.append(el("span", "emote-icon", e.icon), el("span", "emote-name", e.name));
		b.addEventListener("click", () => {
			this.send({ t: "emote", id: e.id });
			this.onClose();
		});
		return b;
	}

	private locked(e: TEmote, gems: number): HTMLElement {
		const cell = el("div", "emote emote-locked");
		const price = e.gems ?? 0;
		cell.append(el("span", "emote-icon", e.icon), el("span", "emote-name", e.name), el("span", "emote-price", `💎 ${price}`));
		const buy = button("Buy with gems", () => this.send({ t: "buyCosmetic", itemId: e.id, via: "gems" }), "btn btn-small");
		if (gems < price) {
			buy.disabled = true;
			buy.title = "Not enough gems";
		}
		cell.append(buy);
		const pack = packWith(e.id);
		if (pack) {
			const get = button(
				"Get pack",
				() => {
					this.send({ t: "buyCosmetic", itemId: e.id, via: "razorpay" });
					this.note.textContent = "Check your Discord DMs to pay";
				},
				"btn btn-small",
			);
			get.title = `${pack.name}, ${formatINR(pack.priceINR)}`;
			cell.append(get);
		}
		return cell;
	}
}
