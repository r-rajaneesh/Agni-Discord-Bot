import { describe, expect, test } from "bun:test";
import { decayMid, matchOrder, npcQuote, sellerFee, type TBookOrder } from "../game/market";

describe("npcQuote", () => {
	test("buying raises the price, selling lowers it", () => {
		const buy = npcQuote("buy", 100, 100, 400, 40);
		const sell = npcQuote("sell", 100, 100, 400, 40);
		expect(buy.newMid).toBeGreaterThan(100);
		expect(sell.newMid).toBeLessThan(100);
		// spread: buy costs more than 40×mid, sell pays less
		expect(buy.total).toBeGreaterThan(4000);
		expect(sell.total).toBeLessThan(4000);
	});

	test("splitting a trade costs about the same as one trade (no gaming the curve)", () => {
		const whole = npcQuote("buy", 50, 50, 300, 30).total;
		let mid = 50;
		let split = 0;
		for (let i = 0; i < 30; i++) {
			const q = npcQuote("buy", mid, 50, 300, 1);
			split += q.total;
			mid = q.newMid;
		}
		// per-unit rounding up adds at most 1 coin per piece
		expect(split).toBeGreaterThanOrEqual(whole);
		expect(split - whole).toBeLessThanOrEqual(30);
	});

	test("round trip loses money (no free arbitrage)", () => {
		const buy = npcQuote("buy", 100, 100, 200, 10);
		const sell = npcQuote("sell", buy.newMid, 100, 200, 10);
		expect(sell.total).toBeLessThan(buy.total);
	});

	test("mid stays within 0.2×–5× base", () => {
		expect(npcQuote("buy", 100, 100, 10, 1000).newMid).toBe(500);
		expect(npcQuote("sell", 100, 100, 10, 1000).newMid).toBe(20);
	});

	test("decay pulls toward base", () => {
		expect(decayMid(200, 100)).toBeCloseTo(190);
		expect(decayMid(50, 100)).toBeCloseTo(55);
	});
});

describe("matchOrder", () => {
	const book: TBookOrder[] = [
		{ id: "s1", userId: "a", side: "sell", price: 12, remaining: 5, at: 2 },
		{ id: "s2", userId: "b", side: "sell", price: 10, remaining: 3, at: 3 },
		{ id: "s3", userId: "c", side: "sell", price: 10, remaining: 4, at: 1 },
		{ id: "s4", userId: "me", side: "sell", price: 9, remaining: 9, at: 0 },
		{ id: "b1", userId: "d", side: "buy", price: 11, remaining: 9, at: 0 },
	];
	test("best price first, then oldest; skips self and non-crossing", () => {
		const r = matchOrder({ userId: "me", side: "buy", price: 11, remaining: 6 }, book);
		expect(r.fills).toEqual([
			{ makerId: "s3", makerUserId: "c", qty: 4, price: 10 },
			{ makerId: "s2", makerUserId: "b", qty: 2, price: 10 },
		]);
		expect(r.remaining).toBe(0);
	});
	test("unfilled remainder rests", () => {
		const r = matchOrder({ userId: "x", side: "buy", price: 9, remaining: 10 }, book);
		expect(r.remaining).toBe(1);
	});
	test("fee rounds up", () => {
		expect(sellerFee(100)).toBe(3);
		expect(sellerFee(10)).toBe(1);
	});
});
