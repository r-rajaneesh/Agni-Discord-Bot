// Pure market math: NPC price impact and player order matching. No Mongo/Discord imports.

/** Price impact strength: trading `liquidity` units moves the mid price by a factor of e */
const K = 1;
/** NPC buy/sell spread around the mid price */
export const SPREAD = 0.05;
/** Fee on player-to-player trades, taken from the seller; a coin sink */
export const TRADE_FEE = 0.03;
/** Hourly pull back toward the base price */
export const DECAY = 0.1;
const MIN_FACTOR = 0.2;
const MAX_FACTOR = 5;

const clampMid = (mid: number, base: number) => Math.min(base * MAX_FACTOR, Math.max(base * MIN_FACTOR, mid));

/**
 * Cost of buying (side "buy") or proceeds of selling `qty` units against the NPC market.
 * Integrates the exponential price curve so splitting a trade into pieces costs the same.
 */
export function npcQuote(side: "buy" | "sell", mid: number, base: number, liquidity: number, qty: number) {
	const k = K / liquidity;
	if (side === "buy") {
		const raw = (mid / k) * (Math.exp(k * qty) - 1);
		return { total: Math.ceil(raw * (1 + SPREAD / 2)), newMid: clampMid(mid * Math.exp(k * qty), base) };
	}
	const raw = (mid / k) * (1 - Math.exp(-k * qty));
	return { total: Math.floor(raw * (1 - SPREAD / 2)), newMid: clampMid(mid * Math.exp(-k * qty), base) };
}

export const decayMid = (mid: number, base: number) => base + (mid - base) * (1 - DECAY);

export interface TBookOrder {
	id: string;
	userId: string;
	side: "buy" | "sell";
	price: number;
	remaining: number;
	at: number;
}

export interface TFill {
	makerId: string;
	makerUserId: string;
	qty: number;
	price: number;
}

/**
 * Matches an incoming limit order against resting orders on the other side.
 * Price-time priority; trades execute at the resting (maker) order's price. Self-trades are skipped.
 */
export function matchOrder(incoming: Omit<TBookOrder, "id" | "at">, book: TBookOrder[]) {
	const opposite = book
		.filter((o) => o.side !== incoming.side && o.remaining > 0 && o.userId !== incoming.userId)
		.filter((o) => (incoming.side === "buy" ? o.price <= incoming.price : o.price >= incoming.price))
		.sort((a, b) => (incoming.side === "buy" ? a.price - b.price : b.price - a.price) || a.at - b.at);
	const fills: TFill[] = [];
	let remaining = incoming.remaining;
	for (const o of opposite) {
		if (remaining <= 0) break;
		const qty = Math.min(remaining, o.remaining);
		fills.push({ makerId: o.id, makerUserId: o.userId, qty, price: o.price });
		remaining -= qty;
	}
	return { fills, remaining };
}

export const sellerFee = (gross: number) => Math.ceil(gross * TRADE_FEE);
