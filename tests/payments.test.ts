import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHmac } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import config from "../config";
import { productById } from "../game/data/products";
import EconomyManager from "../managers/EconomyManager";
import { LedgerEntry, Purchase, Subscription } from "../managers/models/Economy";
import PaymentManager from "../managers/PaymentManager";

setDefaultTimeout(60_000);
const SECRET = "whsec_test";
process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;

let replset: MongoMemoryReplSet;
const dms: string[] = [];
const pushed: string[] = [];
const noop = () => {};
const client: any = {
	economy: new EconomyManager(),
	config,
	log: { info: noop, debug: noop, warn: noop, error: noop },
	makeEmbed: (e: any) => e,
	users: { fetch: async (id: string) => ({ send: async () => dms.push(id) }) },
	gameServer: { pushWallet: async (id: string) => void pushed.push(id) },
};
const payments = new PaymentManager(client);

const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("hex");
const paidEvent = (purchaseId: string, paymentId: string, amount: number) =>
	JSON.stringify({
		event: "payment_link.paid",
		payload: {
			payment_link: { entity: { id: "plink_1", reference_id: purchaseId } },
			payment: { entity: { id: paymentId, amount, currency: "INR" } },
		},
	});

beforeAll(async () => {
	replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" }, binary: { systemBinary: "/usr/bin/mongod" } });
	await mongoose.connect(replset.getUri(), { dbName: "agni_pay_test" });
	await Promise.all([LedgerEntry.init(), Purchase.init(), Subscription.init()]);
});

afterAll(async () => {
	await mongoose.disconnect();
	await replset.stop();
});

describe("razorpay webhook", () => {
	test("rejects a bad signature", async () => {
		const p = await Purchase.create({ userId: "u1", productId: "gems_100", provider: "razorpay" });
		const body = paidEvent(String(p._id), "pay_x", 9900);
		expect(await payments.handleRazorpayWebhook(body, "deadbeef")).toBe(400);
		expect((await client.economy.wallet("u1")).gems).toBe(0);
	});

	test("credits gems once even when the webhook is replayed", async () => {
		const p = await Purchase.create({ userId: "u2", productId: "gems_100", provider: "razorpay" });
		const body = paidEvent(String(p._id), "pay_1", 9900);
		for (let i = 0; i < 3; i++) expect(await payments.handleRazorpayWebhook(body, sign(body))).toBe(200);
		expect((await client.economy.wallet("u2")).gems).toBe(100);
		expect(await Purchase.findById(p._id)).toMatchObject({ status: "paid", paymentId: "pay_1" });
		expect(dms.filter((d) => d === "u2")).toHaveLength(1);
	});

	test("ignores a payment whose amount does not match the product", async () => {
		const p = await Purchase.create({ userId: "u3", productId: "gems_1200", provider: "razorpay" });
		const body = paidEvent(String(p._id), "pay_cheap", 100);
		expect(await payments.handleRazorpayWebhook(body, sign(body))).toBe(200);
		expect((await client.economy.wallet("u3")).gems).toBe(0);
	});

	test("refund claws back gems", async () => {
		const body = JSON.stringify({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_1" } } } });
		expect(await payments.handleRazorpayWebhook(body, sign(body))).toBe(200);
		expect((await client.economy.wallet("u2")).gems).toBe(0);
		// replaying the refund does not double-debit
		await payments.handleRazorpayWebhook(body, sign(body));
		expect((await client.economy.wallet("u2")).gems).toBe(0);
	});
});

describe("farm pass", () => {
	test("a paid link grants the pass once and refreshes the open session once", async () => {
		const p = await Purchase.create({ userId: "u6", productId: "farm_pass", provider: "razorpay" });
		const body = paidEvent(String(p._id), "pay_pass", 19900);
		for (let i = 0; i < 2; i++) expect(await payments.handleRazorpayWebhook(body, sign(body))).toBe(200);
		expect(await payments.hasPass("u6")).toBe(true);
		expect(pushed.filter((u) => u === "u6")).toHaveLength(1);
		expect(dms.filter((d) => d === "u6")).toHaveLength(1);
	});

	test("one-time passes stack and refunds end them", async () => {
		const pass = productById("farm_pass")!;
		await payments.grant("u4", pass, "razorpay:pay_a");
		await payments.grant("u4", pass, "razorpay:pay_b");
		await payments.grant("u4", pass, "razorpay:pay_b");
		const subs = await Subscription.find({ userId: "u4" }).sort({ endsAt: 1 }).lean();
		expect(subs).toHaveLength(2);
		const days = (subs[1]!.endsAt!.getTime() - Date.now()) / 86_400_000;
		expect(days).toBeGreaterThan(59);
		expect(await payments.hasPass("u4")).toBe(true);
		await payments.revoke("u4", pass, "razorpay:pay_a");
		await payments.revoke("u4", pass, "razorpay:pay_b");
		expect(await payments.hasPass("u4")).toBe(false);
	});
});

describe("discord entitlements", () => {
	test("consumable is granted once and consumed", async () => {
		const product = productById("gems_550")!;
		product.discordSku = "sku_550";
		let consumed = 0;
		const ent: any = { id: "ent_1", skuId: "sku_550", userId: "u5", deleted: false, consumed: false, consume: async () => void consumed++ };
		await payments.handleEntitlement(ent);
		await payments.handleEntitlement(ent);
		expect((await client.economy.wallet("u5")).gems).toBe(550);
		expect(consumed).toBe(2); // consume retried safely; the grant was not
		await payments.handleEntitlement(ent, true);
		expect((await client.economy.wallet("u5")).gems).toBe(0);
	});
});
