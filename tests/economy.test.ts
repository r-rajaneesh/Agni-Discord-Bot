import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import EconomyManager from "../managers/EconomyManager";
import { Earning, Inventory, LedgerEntry, MarketItem, Order, Wallet } from "../managers/models/Economy";

let replset: MongoMemoryReplSet;
const models = [Wallet, Inventory, LedgerEntry, MarketItem, Order, Earning] as unknown as mongoose.Model<any>[];
setDefaultTimeout(60_000);

beforeAll(async () => {
	replset = await MongoMemoryReplSet.create({
		replSet: { count: 1, storageEngine: "wiredTiger" },
		binary: process.env.MONGOMS_SYSTEM_BINARY ? undefined : { systemBinary: "/usr/bin/mongod" },
	});
	await mongoose.connect(replset.getUri(), { dbName: "agni_test" });
	await Promise.all(models.map((m) => m.init()));
});

afterAll(async () => {
	await mongoose.disconnect();
	await replset.stop();
});

beforeEach(async () => {
	await Promise.all(models.map((m) => m.deleteMany({})));
});

// Same suite against real transactions and the standalone-Mongo fallback
for (const transactions of [true, false]) {
	describe(`transactions=${transactions}`, () => {
	const eco = new EconomyManager({ transactions, warn: () => {} });
	describe("ledger", () => {
		test("idempotency key applies once, even concurrently", async () => {
			const legs = [{ userId: "u", gems: 100 }];
			const results = await Promise.all(
				Array.from({ length: 5 }, () => eco.transact(legs, { reason: "grant", idempotencyKey: "pay_1" })),
			);
			expect(results.every((r) => r.ok)).toBe(true);
			expect((await eco.wallet("u")).gems).toBe(100);
			expect(await LedgerEntry.countDocuments({ idempotencyKey: "pay_1" })).toBe(1);
		});

		test("debits never go negative under 50 concurrent spends", async () => {
			await eco.transact([{ userId: "u", coins: 100 }], { reason: "seed" });
			const results = await Promise.all(
				Array.from({ length: 50 }, () => eco.transact([{ userId: "u", coins: -10 }], { reason: "spend" })),
			);
			expect(results.filter((r) => r.ok)).toHaveLength(10);
			expect((await eco.wallet("u")).coins).toBe(0);
		});

		test("multi-leg transfer is all-or-nothing", async () => {
			await eco.transact([{ userId: "a", coins: 50 }], { reason: "seed" });
			const r = await eco.transact(
				[
					{ userId: "a", coins: -50 },
					{ userId: "b", items: { wheat: -1 } },
				],
				{ reason: "swap" },
			);
			expect(r).toMatchObject({ ok: false, error: "insufficient_items" });
			expect((await eco.wallet("a")).coins).toBe(50);
		});

		test("allowNegative lets refunds claw back spent gems", async () => {
			await eco.transact([{ userId: "u", gems: 10 }], { reason: "grant" });
			await eco.transact([{ userId: "u", gems: -8 }], { reason: "spend" });
			const r = await eco.transact([{ userId: "u", gems: -10, allowNegative: true }], { reason: "refund" });
			expect(r.ok).toBe(true);
			expect((await eco.wallet("u")).gems).toBe(-8);
		});
	});

	describe("npc market", () => {
		test("buy moves price up, sell pays coins and counts toward the daily cap", async () => {
			await eco.transact([{ userId: "u", coins: 10_000 }], { reason: "seed" });
			const buy = await eco.npcTrade("u", "wheat_seed", "buy", 20);
			expect(buy.ok).toBe(true);
			expect((await MarketItem.findOne({ itemId: "wheat_seed" }))!.mid).toBeGreaterThan(10);
			expect((await eco.inventory("u")).wheat_seed).toBe(20);

			await eco.transact([{ userId: "u", items: { wheat: 5 } }], { reason: "seed" });
			const sell = await eco.npcTrade("u", "wheat", "sell", 5);
			expect(sell.ok).toBe(true);
			expect((await Earning.findOne({ userId: "u" }))!.coins).toBe(sell.ok ? sell.total : -1);
		});

		test("cannot sell items you do not have", async () => {
			expect(await eco.npcTrade("u", "gold", "sell", 1)).toMatchObject({ ok: false, error: "insufficient_items" });
		});

		test("tools are not tradeable", async () => {
			expect(await eco.npcTrade("u", "hoe", "sell", 1)).toMatchObject({ ok: false, error: "invalid" });
		});

		test("hourly job snapshots and decays toward base", async () => {
			await MarketItem.create({ itemId: "wheat", mid: 50, open: 25, high: 50, low: 25, volume: 9 });
			await eco.marketJob(new Date("2026-01-01T10:30:00Z"));
			expect((await MarketItem.findOne({ itemId: "wheat" }))!.mid).toBeCloseTo(47.5);
			const hist = await eco.priceHistory("wheat");
			expect(hist[0]).toMatchObject({ open: 25, close: 50, volume: 9 });
		});
	});

	describe("order book", () => {
		test("crossing orders settle with fee, price improvement refunded", async () => {
			await eco.transact([{ userId: "seller", items: { berry: 10 } }], { reason: "seed" });
			await eco.transact([{ userId: "buyer", coins: 2000 }], { reason: "seed" });

			const ask = await eco.placeOrder("seller", "berry", "sell", 100, 10);
			expect(ask).toMatchObject({ ok: true, filled: 0 });
			const bid = await eco.placeOrder("buyer", "berry", "buy", 120, 4);
			expect(bid).toMatchObject({ ok: true, filled: 4 });

			// buyer paid 4×100, refunded the 20/unit improvement
			expect((await eco.wallet("buyer")).coins).toBe(2000 - 400);
			expect((await eco.inventory("buyer")).berry).toBe(4);
			// seller got 400 minus 3% fee
			expect((await eco.wallet("seller")).coins).toBe(400 - 12);
			const restingAsk = await Order.findById(ask.ok ? ask.orderId : "");
			expect(restingAsk).toMatchObject({ filled: 4, status: "open" });
		});

		test("cancel refunds the unfilled escrow", async () => {
			await eco.transact([{ userId: "b", coins: 500 }], { reason: "seed" });
			const bid = await eco.placeOrder("b", "potato", "buy", 50, 10);
			expect((await eco.wallet("b")).coins).toBe(0);
			const r = await eco.cancelOrder("b", bid.ok ? bid.orderId : "");
			expect(r).toMatchObject({ ok: true, refunded: 10 });
			expect((await eco.wallet("b")).coins).toBe(500);
		});

		test("cannot place a buy you cannot afford", async () => {
			expect(await eco.placeOrder("broke", "potato", "buy", 50, 10)).toMatchObject({ ok: false, error: "insufficient_coins" });
		});
	});
	});
}

describe("fallback rollback", () => {
	const eco = new EconomyManager({ transactions: false, warn: () => {} });
	test("selling items you lack gives no coins and leaves no ledger entry", async () => {
		const before = await LedgerEntry.countDocuments();
		const r = await eco.transact([{ userId: "x", coins: 100, items: { gold: -1 } }], { reason: "fake_sell" });
		expect(r).toMatchObject({ ok: false, error: "insufficient_items" });
		expect((await eco.wallet("x")).coins).toBe(0);
		expect(await LedgerEntry.countDocuments()).toBe(before);
	});
	test("a later failing debit undoes an earlier one", async () => {
		await eco.transact([{ userId: "a", coins: 30 }], { reason: "seed" });
		const r = await eco.transact(
			[
				{ userId: "a", coins: -30 },
				{ userId: "b", coins: -5 },
			],
			{ reason: "swap" },
		);
		expect(r.ok).toBe(false);
		expect((await eco.wallet("a")).coins).toBe(30);
	});
});
