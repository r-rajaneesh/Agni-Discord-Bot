import { AsyncLocalStorage } from "node:async_hooks";
import mongoose, { type ClientSession } from "mongoose";
import { ITEMS } from "../game/data/items";
import { decayMid, matchOrder, npcQuote, sellerFee, type TBookOrder } from "../game/market";
import { Earning, Inventory, LedgerEntry, MarketItem, Order, PriceSnapshot, Wallet } from "./models/Economy";

/** Max coins a user can earn per UTC day by selling to the NPC market (the main coin faucet) */
export const DAILY_EARN_CAP = 25_000;

export interface TLeg {
	userId: string;
	coins?: number;
	gems?: number;
	items?: Record<string, number>;
	/** Refunds/chargebacks may push a balance below zero; spending is then blocked until it recovers */
	allowNegative?: boolean;
}

export interface TMeta {
	reason: string;
	ref?: string;
	/** Same key twice → the second call is a no-op returning the first result */
	idempotencyKey?: string;
}

export type TEconomyError = "insufficient_coins" | "insufficient_gems" | "insufficient_items" | "daily_cap" | "invalid";

export class EconomyError extends Error {
	constructor(public code: TEconomyError, message?: string) {
		super(message ?? code);
	}
}

type TResult<T> = ({ ok: true; duplicate?: boolean } & T) | { ok: false; error: TEconomyError; message: string };

const isDuplicateKey = (e: any) => e?.code === 11000 || e?.cause?.code === 11000;
const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

/**
 * Every coin, gem and item change goes through this class, inside a Mongo transaction,
 * and leaves exactly one LedgerEntry. Uses Mongo transactions on a replica set; on a standalone
 * server it falls back to compensating writes (see withTx), which is safe but not crash-proof.
 */
export default class EconomyManager {
	private transactions: Promise<boolean> | null;
	private warn: (msg: string) => void;
	/** Undo steps for the current non-transactional operation */
	private undoStore = new AsyncLocalStorage<(() => Promise<unknown>)[]>();

	/** `transactions`: force on/off (tests); by default detected from the server */
	constructor(options: { warn?: (msg: string) => void; transactions?: boolean } = {}) {
		this.warn = options.warn ?? console.warn;
		this.transactions = options.transactions === undefined ? null : Promise.resolve(options.transactions);
	}

	private supportsTransactions() {
		this.transactions ??= (async () => {
			const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
			const ok = !!hello.setName || hello.msg === "isdbgrid";
			if (!ok)
				this.warn(
					"[ECONOMY] MongoDB is standalone: running WITHOUT transactions (compensating writes). Convert it to a replica set for production.",
				);
			return ok;
		})().catch((error) => {
			this.transactions = null;
			throw error;
		});
		return this.transactions;
	}

	/** Registers an undo step when running without a transaction */
	private onRollback(session: ClientSession | undefined, undo: () => Promise<unknown>) {
		if (!session) this.undoStore.getStore()?.push(undo);
	}

	/** Runs `fn` atomically and maps EconomyError to a result instead of throwing */
	public async withTx<T extends object>(fn: (session: ClientSession | undefined) => Promise<T>): Promise<TResult<T>> {
		if (!(await this.supportsTransactions())) {
			const undo: (() => Promise<unknown>)[] = [];
			try {
				return { ok: true, ...(await this.undoStore.run(undo, () => fn(undefined))) };
			} catch (error) {
				for (const step of undo.reverse()) await step().catch((e) => this.warn(`[ECONOMY] rollback step failed: ${e}`));
				if (error instanceof EconomyError) return { ok: false, error: error.code, message: error.message };
				throw error;
			}
		}
		const session = await mongoose.startSession();
		try {
			let result: T | undefined;
			await session.withTransaction(async () => {
				result = await fn(session);
			});
			return { ok: true, ...(result as T) };
		} catch (error) {
			if (error instanceof EconomyError) return { ok: false, error: error.code, message: error.message };
			throw error;
		} finally {
			await session.endSession();
		}
	}

	/**
	 * Applies legs inside withTx. Throws EconomyError on insufficient balance.
	 * The ledger entry is inserted first so its idempotency key is claimed before any balance moves,
	 * and all debits run before any credit, so a failed debit never leaves a free credit behind.
	 */
	public async applyLegs(session: ClientSession | undefined, legs: TLeg[], meta: TMeta) {
		const [entry] = await LedgerEntry.create([{ idempotencyKey: meta.idempotencyKey, reason: meta.reason, ref: meta.ref, legs: [] }], {
			session,
		});
		this.onRollback(session, () => LedgerEntry.deleteOne({ _id: entry!._id }));

		const after = new Map<number, { coins: number; gems: number }>();
		const wallet = async (i: number, leg: TLeg) => {
			const coins = leg.coins ?? 0;
			const gems = leg.gems ?? 0;
			await Wallet.updateOne({ userId: leg.userId }, { $setOnInsert: { coins: 0, gems: 0 } }, { upsert: true, session });
			const filter: Record<string, unknown> = { userId: leg.userId };
			if (!leg.allowNegative) {
				if (coins < 0) filter.coins = { $gte: -coins };
				if (gems < 0) filter.gems = { $gte: -gems };
			}
			const res = await Wallet.findOneAndUpdate(filter, { $inc: { coins, gems } }, { new: true, session }).lean();
			if (!res) throw new EconomyError(coins < 0 ? "insufficient_coins" : "insufficient_gems");
			this.onRollback(session, () => Wallet.updateOne({ userId: leg.userId }, { $inc: { coins: -coins, gems: -gems } }));
			after.set(i, { coins: res.coins, gems: res.gems });
		};
		const item = async (userId: string, itemId: string, qty: number) => {
			if (!ITEMS[itemId]) throw new EconomyError("invalid", `Unknown item ${itemId}`);
			if (qty < 0) {
				const res = await Inventory.updateOne({ userId, itemId, qty: { $gte: -qty } }, { $inc: { qty } }, { session });
				if (res.matchedCount === 0) throw new EconomyError("insufficient_items", `Not enough ${ITEMS[itemId]?.name}`);
			} else await Inventory.updateOne({ userId, itemId }, { $inc: { qty } }, { upsert: true, session });
			this.onRollback(session, () => Inventory.updateOne({ userId, itemId }, { $inc: { qty: -qty } }));
		};

		const isDebit = (leg: TLeg) => (leg.coins ?? 0) < 0 || (leg.gems ?? 0) < 0;
		for (const debitPhase of [true, false]) {
			for (const [i, leg] of legs.entries()) {
				if ((leg.coins || leg.gems) && isDebit(leg) === debitPhase) await wallet(i, leg);
				for (const [itemId, qty] of Object.entries(leg.items ?? {}))
					if (qty && qty < 0 === debitPhase) await item(leg.userId, itemId, qty);
			}
		}

		const recorded = legs.map((leg, i) => ({
			...leg,
			allowNegative: undefined,
			coinsAfter: after.get(i)?.coins,
			gemsAfter: after.get(i)?.gems,
		}));
		await LedgerEntry.updateOne({ _id: entry!._id }, { $set: { legs: recorded } }, { session });
		return entry!;
	}

	/** Atomic multi-user transfer. Idempotent when `meta.idempotencyKey` is set. */
	public async transact(legs: TLeg[], meta: TMeta): Promise<TResult<{ entryId: string }>> {
		if (meta.idempotencyKey) {
			const existing = await LedgerEntry.findOne({ idempotencyKey: meta.idempotencyKey }).lean();
			if (existing) return { ok: true, duplicate: true, entryId: String(existing._id) };
		}
		try {
			return await this.withTx(async (session) => ({ entryId: String((await this.applyLegs(session, legs, meta))._id) }));
		} catch (error) {
			// Two concurrent calls with the same key: the loser hits the unique index
			if (meta.idempotencyKey && isDuplicateKey(error)) {
				const existing = await LedgerEntry.findOne({ idempotencyKey: meta.idempotencyKey }).lean();
				if (existing) return { ok: true, duplicate: true, entryId: String(existing._id) };
			}
			throw error;
		}
	}

	/** True once an entry with this idempotency key exists */
	public async hasEntry(idempotencyKey: string) {
		return !!(await LedgerEntry.exists({ idempotencyKey }));
	}

	public async wallet(userId: string) {
		const w = await Wallet.findOne({ userId }).lean();
		return { coins: w?.coins ?? 0, gems: w?.gems ?? 0 };
	}

	public async inventory(userId: string) {
		const rows = await Inventory.find({ userId, qty: { $gt: 0 } }).lean();
		return Object.fromEntries(rows.map((r) => [r.itemId, r.qty])) as Record<string, number>;
	}

	// ---------- NPC market ----------

	private async marketRow(itemId: string, session?: ClientSession) {
		const base = ITEMS[itemId]!.basePrice;
		return (await MarketItem.findOneAndUpdate(
			{ itemId },
			{ $setOnInsert: { mid: base, open: base, high: base, low: base, volume: 0 } },
			{ upsert: true, new: true, session },
		).lean())!;
	}

	public async npcPrices(itemIds: string[]) {
		const rows = await MarketItem.find({ itemId: { $in: itemIds } }).lean();
		const byId = new Map(rows.map((r) => [r.itemId, r.mid]));
		return Object.fromEntries(
			itemIds.map((id) => {
				const item = ITEMS[id]!;
				const mid = byId.get(id) ?? item.basePrice;
				return [id, { mid, buy: npcQuote("buy", mid, item.basePrice, item.liquidity, 1).total, sell: npcQuote("sell", mid, item.basePrice, item.liquidity, 1).total }];
			}),
		) as Record<string, { mid: number; buy: number; sell: number }>;
	}

	/** Buy from / sell to the NPC market at the live price; the trade moves the price. */
	public async npcTrade(userId: string, itemId: string, side: "buy" | "sell", qty: number) {
		const item = ITEMS[itemId];
		if (!item?.tradeable || !Number.isInteger(qty) || qty <= 0 || qty > 999)
			return { ok: false as const, error: "invalid" as const, message: "Invalid trade." };
		return this.withTx(async (session) => {
			const row = await this.marketRow(itemId, session);
			const quote = npcQuote(side, row.mid, item.basePrice, item.liquidity, qty);
			if (side === "sell") {
				const earned = await Earning.findOneAndUpdate(
					{ userId, day: utcDay() },
					{ $inc: { coins: quote.total } },
					{ upsert: true, new: true, session },
				);
				this.onRollback(session, () => Earning.updateOne({ userId, day: utcDay() }, { $inc: { coins: -quote.total } }));
				if (earned!.coins > DAILY_EARN_CAP)
					throw new EconomyError("daily_cap", `Daily selling limit of ${DAILY_EARN_CAP} coins reached. Resets at 00:00 UTC.`);
			}
			await this.applyLegs(
				session,
				[{ userId, coins: side === "buy" ? -quote.total : quote.total, items: { [itemId]: side === "buy" ? qty : -qty } }],
				{ reason: `npc_${side}`, ref: itemId },
			);
			await MarketItem.updateOne(
				{ itemId },
				{
					$set: { mid: quote.newMid },
					$max: { high: quote.newMid },
					$min: { low: quote.newMid },
					$inc: { volume: qty },
				},
				{ session },
			);
			return { total: quote.total, newMid: quote.newMid };
		});
	}

	/** Hourly: write an OHLC candle per item, then decay prices toward base. */
	public async marketJob(now = new Date()) {
		const hour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
		const rows = await MarketItem.find().lean();
		for (const r of rows) {
			const base = ITEMS[r.itemId]?.basePrice;
			if (!base) continue;
			await PriceSnapshot.updateOne(
				{ itemId: r.itemId, hour },
				{ $set: { open: r.open ?? r.mid, high: r.high ?? r.mid, low: r.low ?? r.mid, close: r.mid, volume: r.volume ?? 0 } },
				{ upsert: true },
			);
			const mid = decayMid(r.mid, base);
			// Only touch rows nobody traded since we read them; a missed decay is harmless
			await MarketItem.updateOne({ _id: r._id, mid: r.mid }, { $set: { mid, open: mid, high: mid, low: mid, volume: 0 } });
		}
	}

	public async priceHistory(itemId: string, hours = 48) {
		return PriceSnapshot.find({ itemId }).sort({ hour: -1 }).limit(hours).lean().then((r) => r.reverse());
	}

	// ---------- Player order book ----------

	public async placeOrder(userId: string, itemId: string, side: "buy" | "sell", price: number, qty: number) {
		const item = ITEMS[itemId];
		if (!item?.tradeable || !Number.isInteger(price) || !Number.isInteger(qty) || price <= 0 || qty <= 0 || qty > 9999)
			return { ok: false as const, error: "invalid" as const, message: "Invalid order." };
		return this.withTx(async (session) => {
			// Escrow first: coins for buys, items for sells
			await this.applyLegs(
				session,
				[side === "buy" ? { userId, coins: -price * qty } : { userId, items: { [itemId]: -qty } }],
				{ reason: "order_escrow", ref: itemId },
			);
			const opposite = side === "buy" ? "sell" : "buy";
			const resting = await Order.find({
				itemId,
				side: opposite,
				status: "open",
				price: side === "buy" ? { $lte: price } : { $gte: price },
			})
				.sort({ price: side === "buy" ? 1 : -1, at: 1 })
				.limit(100)
				.session(session ?? null)
				.lean();
			const book: TBookOrder[] = resting.map((o) => ({
				id: String(o._id),
				userId: o.userId,
				side: o.side as "buy" | "sell",
				price: o.price,
				remaining: o.qty - o.filled,
				at: o.at.getTime(),
			}));
			const { fills, remaining } = matchOrder({ userId, side, price, remaining: qty }, book);

			const legs: TLeg[] = [];
			for (const f of fills) {
				const gross = f.price * f.qty;
				const buyerId = side === "buy" ? userId : f.makerUserId;
				const sellerId = side === "buy" ? f.makerUserId : userId;
				legs.push({ userId: buyerId, items: { [itemId]: f.qty } });
				legs.push({ userId: sellerId, coins: gross - sellerFee(gross) });
				// Taker buy paid its own limit price into escrow; refund the price improvement
				if (side === "buy" && price > f.price) legs.push({ userId, coins: (price - f.price) * f.qty });
				const maker = resting.find((o) => String(o._id) === f.makerId)!;
				const filled = maker.filled + f.qty;
				const claimed = await Order.updateOne(
					{ _id: maker._id, filled: maker.filled, status: "open" },
					{ $set: { filled, status: filled >= maker.qty ? "filled" : "open" } },
					{ session },
				);
				// Someone else filled this order since we read the book; abort (and roll back) rather than overfill
				if (claimed.matchedCount === 0) throw new EconomyError("invalid", "The order book changed. Please try again.");
				this.onRollback(session, () => Order.updateOne({ _id: maker._id }, { $set: { filled: maker.filled, status: "open" } }));
			}
			if (legs.length) await this.applyLegs(session, legs, { reason: "order_settle", ref: itemId });
			const [order] = await Order.create(
				[{ userId, itemId, side, price, qty, filled: qty - remaining, status: remaining === 0 ? "filled" : "open" }],
				{ session },
			);
			return { orderId: String(order!._id), filled: qty - remaining, fills };
		});
	}

	public async cancelOrder(userId: string, orderId: string) {
		if (!mongoose.isValidObjectId(orderId)) return { ok: false as const, error: "invalid" as const, message: "Unknown order." };
		return this.withTx(async (session) => {
			const order = await Order.findOneAndUpdate(
				{ _id: orderId, userId, status: "open" },
				{ $set: { status: "cancelled" } },
				{ new: true, session },
			).lean();
			if (!order) throw new EconomyError("invalid", "No open order with that id.");
			this.onRollback(session, () => Order.updateOne({ _id: order._id }, { $set: { status: "open" } }));
			const left = order.qty - order.filled;
			await this.applyLegs(
				session,
				[order.side === "buy" ? { userId, coins: order.price * left } : { userId, items: { [order.itemId]: left } }],
				{ reason: "order_cancel", ref: orderId },
			);
			return { refunded: left };
		});
	}

	public async openOrders(userId: string) {
		return Order.find({ userId, status: "open" }).sort({ at: -1 }).limit(25).lean();
	}

	public async orderBook(itemId: string, depth = 5) {
		const [bids, asks] = await Promise.all([
			Order.find({ itemId, side: "buy", status: "open" }).sort({ price: -1, at: 1 }).limit(depth).lean(),
			Order.find({ itemId, side: "sell", status: "open" }).sort({ price: 1, at: 1 }).limit(depth).lean(),
		]);
		return { bids, asks };
	}

	/** Total coins and gems in circulation (admin stats) */
	public async moneySupply() {
		const [agg] = await Wallet.aggregate([{ $group: { _id: null, coins: { $sum: "$coins" }, gems: { $sum: "$gems" }, wallets: { $sum: 1 } } }]);
		return { coins: agg?.coins ?? 0, gems: agg?.gems ?? 0, wallets: agg?.wallets ?? 0 };
	}
}
