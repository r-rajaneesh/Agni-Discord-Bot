// Buying the next chunk of your land: opens when you use a fence at the edge of a locked chunk
import { canUnlock, chunkOf, unlockPrice } from "@game/chunks";
import { facedTile, terrainAt } from "@game/engine";
import { T } from "@game/map";
import type { TClientMsg } from "@game/protocol";
import type { ClientState } from "../state";
import { button, el, Panel } from "./dom";

export interface TUnlockTarget {
	cx: number;
	cy: number;
	price: number;
}

/** The locked chunk you face on your own land, when it can be bought next */
export function unlockTarget(state: ClientState, now: number): TUnlockTarget | null {
	const { instance: inst, you, userId } = state;
	if (!inst || !you || inst.kind !== "land" || inst.ownerId !== userId) return null;
	const f = facedTile({ ...you, energy: 0, lastEnergyAt: 0 });
	if (terrainAt(inst, f.x, f.y, now) !== T.fence) return null;
	const { cx, cy } = chunkOf(f.x, f.y);
	if (!canUnlock(inst.unlocked, cx, cy)) return null;
	return { cx, cy, price: unlockPrice(inst.unlocked.size) };
}

export class UnlockPanel extends Panel {
	constructor(
		private state: ClientState,
		private send: (m: TClientMsg) => void,
	) {
		super("Expand your land", "panel-unlock");
	}

	openFor(t: TUnlockTarget): void {
		const coins = this.state.wallet.coins;
		const price = el("p", "big", `🪙 ${t.price.toLocaleString()}`);
		const go = button("Unlock", () => {
			this.send({ t: "unlock", cx: t.cx, cy: t.cy });
			this.onClose();
		}, "btn btn-primary");
		const cancel = button("Not now", () => this.onClose());
		const acts = el("div", "panel-actions");
		acts.append(cancel, go);
		this.body.replaceChildren(
			el("p", "", "Clear the fence and add this 16×16 chunk to your farm."),
			price,
			el("p", coins < t.price ? "muted bad" : "muted", `You have 🪙 ${coins.toLocaleString()}`),
			acts,
		);
		this.show();
	}
}
