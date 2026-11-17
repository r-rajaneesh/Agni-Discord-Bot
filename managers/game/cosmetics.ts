// Emotes and cosmetics over the websocket: playing an emote, and unlocking one with gems or a Razorpay pack.
import { EMOTES, FREE_EMOTES, canUseEmote } from "../../game/data/emotes";
import { packWith } from "../../game/data/products";
import type { TServerMsg } from "../../game/protocol";
import type { TSession } from "../GameServer";
import { Ownership, own } from "../models/Cosmetics";
import { buyProduct, limited, transact, type TActionCtx } from "./actions";

/** One emote per player per this long */
export const EMOTE_GAP_MS = 2000;

/** What the player may use: every free emote, then what they own */
export const ownedMsg = (s: TSession): TServerMsg => ({ t: "owned", items: [...FREE_EMOTES, ...s.owned] });

/** Plays an emote for the player and everyone in their AOI. Its own limiter, apart from the action one. */
export function emote(ctx: TActionCtx, s: TSession, id: string): void {
	const now = ctx.now();
	if (now - s.emoteAt < EMOTE_GAP_MS) {
		if (now - s.emoteSlowedAt >= 1000) {
			s.emoteSlowedAt = now;
			ctx.toast(s, "Slow down.", false);
		}
		return;
	}
	// Refused emotes count too, so their toasts are throttled like real ones
	s.emoteAt = now;
	if (!EMOTES[id]) return ctx.toast(s, "Unknown emote.", false);
	if (!canUseEmote(id, s.owned)) return ctx.toast(s, "Unlock this emote first.", false);
	const msg: TServerMsg = { t: "emote", userId: s.userId, id };
	ctx.send(s.ws, msg);
	for (const o of s.visible) ctx.send(o.ws, msg);
}

/** Unlocks a premium emote with earned gems, or DMs the link to the Razorpay pack that has it */
export async function buyCosmetic(ctx: TActionCtx, s: TSession, itemId: string, via: "gems" | "razorpay"): Promise<void> {
	if (limited(ctx, s)) return;
	const e = EMOTES[itemId];
	if (!e) return ctx.toast(s, "Unknown emote.", false);
	if (canUseEmote(itemId, s.owned)) return ctx.toast(s, "You already own this.", false);
	if (via === "razorpay") {
		const pack = packWith(itemId);
		if (!pack) return ctx.toast(s, "This emote is only available for gems.", false);
		return buyProduct(ctx, s, pack.id);
	}
	const { userId } = s;
	// Keyed by player and item, so parallel buys debit once; a buy already paid for is a no-op debit
	const t = await transact(ctx, [{ userId, gems: -(e.gems ?? 0) }], { reason: "cosmetic", ref: itemId, idempotencyKey: `cosmetic:${userId}:${itemId}` });
	if (!t.ok) return ctx.toast(s, t.message, false);
	let added: boolean;
	try {
		added = await own(userId, itemId, "gems");
		// Freshly paid in gems, but a pack grant wrote the row first: it becomes the gems row, so refunding the pack keeps it
		if (!added && !t.duplicate) {
			await Ownership.updateOne({ userId, itemId }, { $set: { source: "gems" }, $unset: { sourceKey: 1 } });
			added = true;
		}
	} catch (err) {
		// Paid: a retry finds the debit done and only records the item
		ctx.deps.log.error(`[GAME] recording ${itemId} for ${userId} failed`, err);
		return ctx.toast(s, "Something went wrong. Try again.", false);
	}
	s.owned.add(itemId);
	ctx.send(s.ws, ownedMsg(s));
	if (added) ctx.toast(s, `${e.icon} Unlocked ${e.name}!`, true);
	await ctx.pushWallet(userId);
}
