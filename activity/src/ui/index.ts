// The DOM layer over the game: HUD, hotbar, toasts and one panel at a time
import { facedTile, HOUSE_DOOR } from "@game/engine";
import type { TClientMsg, TServerMsg } from "@game/protocol";
import type { ClientState } from "../state";
import type { Panel } from "./dom";
import { el } from "./dom";
import { Hotbar } from "./hotbar";
import { Hud } from "./hud";
import { InventoryPanel } from "./inventory";
import { LobbyPanel } from "./lobbies";
import { ShopPanel } from "./shop";
import { StorePanel } from "./store";
import { Toasts } from "./toast";
import { UnlockPanel, unlockTarget } from "./unlock";
import "./ui.css";

export class GameUI {
	readonly root = el("div", "ui");
	private hud: Hud;
	private hotbar: Hotbar;
	private toasts: Toasts;
	private inventory: InventoryPanel;
	private shop: ShopPanel;
	private store: StorePanel;
	private lobbies: LobbyPanel;
	private unlock: UnlockPanel;
	private current: Panel | null = null;
	private useSeq = 0;

	constructor(
		parent: HTMLElement,
		private state: ClientState,
		private send: (m: TClientMsg) => void,
	) {
		const equip = (item: string) => this.send({ t: "equip", item });
		this.hud = new Hud(this.root, state, { lobbies: () => this.toggleLobbies(), inventory: () => this.toggleInventory(), store: () => this.open(this.store) });
		this.toasts = new Toasts(this.root);
		this.hotbar = new Hotbar(this.root, state, equip);
		this.inventory = new InventoryPanel(state, equip);
		this.shop = new ShopPanel(state, send);
		this.store = new StorePanel(send);
		this.lobbies = new LobbyPanel(send);
		this.unlock = new UnlockPanel(state, send);
		const layer = el("div", "panels");
		for (const p of [this.inventory, this.shop, this.store, this.lobbies, this.unlock]) {
			p.onClose = () => this.close();
			layer.append(p.root);
		}
		// Task 16 builds the chat box on this element and unhides it
		const chat = el("input", "chat-input");
		chat.id = "chat-input";
		chat.type = "text";
		chat.maxLength = 200;
		chat.autocomplete = "off";
		chat.hidden = true;
		this.root.append(layer, chat);
		parent.append(this.root);
	}

	/** Server messages that concern the overlays; call after ClientState.apply */
	message(m: TServerMsg): void {
		switch (m.t) {
			case "toast":
				return this.toasts.show(m.msg, m.ok);
			case "menu":
				this.shop.render();
				return this.open(this.shop);
			case "lobbyList":
				this.lobbies.render(m);
				return this.open(this.lobbies);
			case "wallet":
				if (this.inventory.open) this.inventory.render();
				if (this.shop.open) this.shop.render();
				return;
			case "welcome":
				// A new place: the store door or fence the panel was for is gone
				return this.close();
		}
	}

	/** Every frame */
	update(now: number): void {
		this.hud.update(now);
		this.hotbar.update();
	}

	/** E, Space or A: buy land at a fence, sleep at your door, else the server's context action */
	use(): void {
		const { instance: inst, you, userId } = this.state;
		if (!inst || !you) return;
		const t = unlockTarget(this.state, Date.now());
		if (t) {
			this.open(this.unlock);
			this.unlock.openFor(t);
			return;
		}
		const f = facedTile({ ...you, energy: 0, lastEnergyAt: 0 });
		if (inst.kind === "land" && inst.ownerId === userId && f.x === HOUSE_DOOR.x && f.y === HOUSE_DOOR.y) this.send({ t: "sleep" });
		else this.send({ t: "use", seq: ++this.useSeq });
	}

	slot(i: number): void {
		this.hotbar.slot(i);
	}

	toggleInventory(): void {
		if (this.inventory.open) return this.close();
		this.inventory.render();
		this.open(this.inventory);
	}

	toggleLobbies(): void {
		if (this.lobbies.open) return this.close();
		this.open(this.lobbies);
		this.lobbies.request();
	}

	/** Enter: focus the chat box once Task 16 has made it visible */
	focusChat(): void {
		const c = document.getElementById("chat-input");
		if (c instanceof HTMLInputElement && !c.hidden) c.focus();
	}

	close(): void {
		this.current?.hide();
		this.current = null;
	}

	private open(p: Panel): void {
		if (this.current !== p) this.current?.hide();
		this.current = p;
		p.show();
	}
}
