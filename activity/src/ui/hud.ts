// Top bar: coins, gems, energy, the clock and where you are (which opens the lobby list)
import { clock, MAX_ENERGY, type TInstance } from "@game/engine";
import type { ClientState } from "../state";
import { button, el } from "./dom";

export const PUBLIC_LABEL = "Public";

/** "Your land" on private land, "Lobby #n" in a public lobby, "<label> #n" in a home lobby */
export function placeName(inst: TInstance, userId: string | null): string {
	if (inst.kind === "land") return inst.ownerId === userId ? "Your land" : "Private land";
	const lobby = inst.lobby;
	if (!lobby) return "The valley";
	return lobby.label === PUBLIC_LABEL ? `Lobby #${lobby.n}` : `${lobby.label} #${lobby.n}`;
}

export interface THudActions {
	lobbies(): void;
	inventory(): void;
	store(): void;
	emotes(): void;
}

export class Hud {
	private coins = el("span", "stat");
	private gems = el("span", "stat");
	private energyFill = el("span", "energy-fill");
	private energyText = el("span", "energy-text");
	private time = el("span", "stat clock");
	private place: HTMLButtonElement;
	private last = "";

	constructor(
		parent: HTMLElement,
		private state: ClientState,
		actions: THudActions,
	) {
		const left = el("div", "hud");
		const energy = el("span", "energy");
		energy.title = "Energy";
		energy.append(this.energyFill, this.energyText);
		this.coins.title = "Coins";
		this.gems.title = "Gems";
		const row1 = el("div", "hud-row");
		row1.append(this.coins, this.gems, energy);
		this.place = button("", () => actions.lobbies(), "btn btn-place");
		this.place.title = "Switch lobby (L)";
		const row2 = el("div", "hud-row");
		row2.append(this.time, this.place);
		left.append(row1, row2);

		const right = el("div", "hud-buttons");
		const bag = button("🎒", () => actions.inventory(), "btn btn-icon");
		bag.title = "Inventory (I)";
		bag.setAttribute("aria-label", "Inventory");
		const emotes = button("😀", () => actions.emotes(), "btn btn-icon");
		emotes.title = "Emotes (T)";
		emotes.setAttribute("aria-label", "Emotes");
		const store = button("👑 Store", () => actions.store(), "btn btn-store");
		right.append(emotes, bag, store);
		parent.append(left, right);
	}

	/** Called every frame; touches the DOM only when something shown changed */
	update(now: number): void {
		const { wallet, instance } = this.state;
		const c = instance ? clock(instance.epoch, now) : null;
		const place = instance ? placeName(instance, this.state.userId) : "";
		const key = `${wallet.coins}|${wallet.gems}|${wallet.energy}|${c?.day}|${c?.label}|${place}`;
		if (key === this.last) return;
		this.last = key;
		this.coins.textContent = `🪙 ${wallet.coins.toLocaleString()}`;
		this.gems.textContent = `💎 ${wallet.gems.toLocaleString()}`;
		const e = Math.max(0, Math.min(MAX_ENERGY, wallet.energy));
		this.energyFill.style.width = `${(e / MAX_ENERGY) * 100}%`;
		this.energyText.textContent = `⚡ ${e}`;
		this.time.textContent = c ? `Day ${c.day} · ${c.label}` : "";
		this.place.textContent = `📍 ${place}`;
	}
}
