import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import * as Discord from "discord.js";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import config from "../config";
import { productById } from "../game/data/products";
import EconomyManager from "../managers/EconomyManager";
import { Ownership } from "../managers/models/Cosmetics";
import { LedgerEntry, Purchase, Subscription } from "../managers/models/Economy";
import PaymentManager from "../managers/PaymentManager";

setDefaultTimeout(60_000);
const SECRET = "whsec_test";
process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;

let replset: MongoMemoryReplSet;
const dms: string[] = [];
const pushed: string[] = [];
const owned: string[] = [];
const warns: unknown[][] = [];
const errors: unknown[][] = [];
const noop = () => {};
let ready = true;
// Runs inside revoke(), so a test can see the purchase's state mid-refund
let onPushOwned = async (_id: string) => {};
const client: any = Object.assign(new EventEmitter(), {
	economy: new EconomyManager(),
	config,
	log: { info: noop, debug: noop, warn: (...a: unknown[]) => void warns.push(a), error: (...a: unknown[]) => void errors.push(a) },
	makeEmbed: (e: any) => e,
	isReady: () => ready,
	users: { fetch: async (id: string) => ({ send: async () => dms.push(id) }) },
	gameServer: {
		pushWallet: async (id: string) => void pushed.push(id),
		pushOwned: async (id: string) => {
			owned.push(id);
			await onPushOwned(id);
		},
	},
});
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
	await Promise.all([LedgerEntry.init(), Purchase.init(), Subscription.init(), Ownership.init()]);
});

afterAll(async () => {
	await mongoose.disconnect();
	await replset.stop();
});

describe("razorpay webhook", () => {
	test("rejects a bad signature", async () => {
		const p = await Purchase.create({ userId: "u1", productId: "farm_pass", provider: "razorpay" });
		const body = paidEvent(String(p._id), "pay_x", 19900);
		expect(await payments.handleRazorpayWebhook(body, "deadbeef")).toBe(400);
		expect(await payments.hasPass("u1")).toBe(false);
	});

	test("grants once even when the webhook is replayed", async () => {
		const p = await Purchase.create({ userId: "u2", productId: "farm_pass", provider: "razorpay" });
		const body = paidEvent(String(p._id), "pay_1", 19900);
		for (let i = 0; i < 3; i++) expect(await payments.handleRazorpayWebhook(body, sign(body))).toBe(200);
		expect(await Subscription.countDocuments({ userId: "u2" })).toBe(1);
		expect(await Purchase.findById(p._id)).toMatchObject({ status: "paid", paymentId: "pay_1" });
		expect(dms.filter((d) => d === "u2")).toHaveLength(1);
	});

	test("ignores a payment whose amount does not match the product", async () => {
		const p = await Purchase.create({ userId: "u3", productId: "farm_pass", provider: "razorpay" });
		const body = paidEvent(String(p._id), "pay_cheap", 100);
		expect(await payments.handleRazorpayWebhook(body, sign(body))).toBe(200);
		expect(await payments.hasPass("u3")).toBe(false);
	});

	test("a paid link for a product no longer sold grants nothing", async () => {
		const p = await Purchase.create({ userId: "u7", productId: "gems_100", provider: "razorpay" });
		const body = paidEvent(String(p._id), "pay_old", 9900);
		expect(await payments.handleRazorpayWebhook(body, sign(body))).toBe(200);
		expect((await client.economy.wallet("u7")).gems).toBe(0);
	});

	test("refund ends the pass", async () => {
		const body = JSON.stringify({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_1" } } } });
		expect(await payments.handleRazorpayWebhook(body, sign(body))).toBe(200);
		expect(await payments.hasPass("u2")).toBe(false);
		expect(await Purchase.findOne({ paymentId: "pay_1" })).toMatchObject({ status: "refunded" });
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
	test("a pass entitlement mirrors Discord's end date and is revoked on delete", async () => {
		const product = productById("farm_pass")!;
		const sku = product.discordSku;
		product.discordSku = "sku_pass";
		const endsAt = new Date(Date.now() + 10 * 86_400_000);
		const ent: any = { id: "ent_1", skuId: "sku_pass", userId: "u5", deleted: false, endsAt, isActive: () => true };
		await payments.handleEntitlement(ent);
		await payments.handleEntitlement(ent);
		expect(await Subscription.countDocuments({ userId: "u5" })).toBe(1);
		expect((await Subscription.findOne({ userId: "u5" }).lean())!.endsAt).toEqual(endsAt);
		expect(await payments.hasPass("u5")).toBe(true);
		await payments.handleEntitlement(ent, true);
		expect(await payments.hasPass("u5")).toBe(false);
		product.discordSku = sku;
	});
});

describe("emotes", () => {
	const PACK = ["breakdance", "moonwalk", "backflip", "chicken_dance", "spin"];
	const items = async (userId: string) => (await Ownership.find({ userId }).lean()).map((o) => o.itemId).sort();

	test("cosmetic grant creates Ownership rows once", async () => {
		const p = await Purchase.create({ userId: "e1", productId: "emotes_party_pack", provider: "razorpay" });
		const body = paidEvent(String(p._id), "pay_pack", 14900);
		for (let i = 0; i < 3; i++) expect(await payments.handleRazorpayWebhook(body, sign(body))).toBe(200);
		expect(await items("e1")).toEqual([...PACK].sort());
		const rows = await Ownership.find({ userId: "e1", itemId: "spin" }).lean();
		expect(rows).toMatchObject([{ source: "razorpay", sourceKey: "razorpay:pay_pack:spin" }]);
		// The open session gets its wallet and what it owns, once
		expect(pushed.filter((u) => u === "e1")).toHaveLength(1);
		expect(owned.filter((u) => u === "e1")).toHaveLength(1);
		expect(dms.filter((d) => d === "e1")).toHaveLength(1);
	});

	const pay = async (userId: string, paymentId: string) => {
		const p = await Purchase.create({ userId, productId: "emotes_party_pack", provider: "razorpay" });
		const body = paidEvent(String(p._id), paymentId, 14900);
		expect(await payments.handleRazorpayWebhook(body, sign(body))).toBe(200);
		return p;
	};
	const refund = async (paymentId: string) => {
		const body = JSON.stringify({ event: "refund.processed", payload: { refund: { entity: { id: `rfnd_${paymentId}`, payment_id: paymentId } } } });
		expect(await payments.handleRazorpayWebhook(body, sign(body))).toBe(200);
	};

	test("a pack paid twice and refunded once keeps its items", async () => {
		await pay("e4", "pay_e4a");
		// The second payment adds no rows: the first holds every item
		await pay("e4", "pay_e4b");
		await refund("pay_e4a");
		expect(await items("e4")).toEqual([...PACK].sort());
		const keys = (await Ownership.find({ userId: "e4" }).lean()).map((o) => o.sourceKey).sort();
		expect(keys).toEqual(PACK.map((id) => `razorpay:pay_e4b:${id}`).sort());
		// Refunding the second one too takes everything
		await refund("pay_e4b");
		expect(await items("e4")).toEqual([]);
	});

	test("a pack paid while every item is owned is recorded, receipted and flagged for refund", async () => {
		for (const itemId of PACK) await Ownership.create({ userId: "e5", itemId, source: "gems" });
		const n = warns.length;
		const p = await pay("e5", "pay_e5");
		// A replay sends nothing more
		const body = paidEvent(String(p._id), "pay_e5", 14900);
		expect(await payments.handleRazorpayWebhook(body, sign(body))).toBe(200);
		expect(await Purchase.findById(p._id)).toMatchObject({ status: "paid", paymentId: "pay_e5" });
		expect(dms.filter((d) => d === "e5")).toHaveLength(1);
		expect(warns.slice(n)).toHaveLength(1);
		expect(JSON.stringify(warns.at(-1))).toContain("pay_e5");
		// Nothing changed hands
		expect(await Ownership.countDocuments({ userId: "e5", source: "gems" })).toBe(5);
	});

	test("a paid event replayed after the refund grants nothing", async () => {
		const p = await pay("e7", "pay_e7");
		let statusAtRevoke: string | undefined;
		onPushOwned = async (id) => {
			if (id === "e7") statusAtRevoke = (await Purchase.findById(p._id).lean())!.status;
		};
		await refund("pay_e7");
		onPushOwned = async () => {};
		// The purchase is marked refunded before its items are taken, so a crash mid-refund can't leave it "paid"
		expect(statusAtRevoke).toBe("refunded");
		expect(await items("e7")).toEqual([]);
		const body = paidEvent(String(p._id), "pay_e7", 14900);
		expect(await payments.handleRazorpayWebhook(body, sign(body))).toBe(200);
		expect(await items("e7")).toEqual([]);
		expect(await Purchase.findById(p._id)).toMatchObject({ status: "refunded" });
		expect(dms.filter((d) => d === "e7")).toHaveLength(1);
	});

	test("a refund for a payment we never recorded is logged with its ids", async () => {
		const n = errors.length;
		await refund("pay_unknown");
		expect(errors.slice(n)).toHaveLength(1);
		expect(JSON.stringify(errors.at(-1))).toContain("rfnd_pay_unknown");
		expect(JSON.stringify(errors.at(-1))).toContain("pay_unknown");
	});

	test("the paid amount is checked against the price when the link was made", async () => {
		const pack = productById("emotes_party_pack")!;
		const p = await Purchase.create({ userId: "e8", productId: pack.id, provider: "razorpay", amount: 14900 });
		const price = pack.priceINR;
		pack.priceINR = 19900;
		try {
			const body = paidEvent(String(p._id), "pay_e8", 14900);
			expect(await payments.handleRazorpayWebhook(body, sign(body))).toBe(200);
		} finally {
			pack.priceINR = price;
		}
		expect(await items("e8")).toEqual([...PACK].sort());
	});

	test("a receipt for a webhook served before login goes out once the bot is ready", async () => {
		ready = false;
		try {
			await pay("e9", "pay_e9");
			expect(await items("e9")).toEqual([...PACK].sort());
			expect(dms.filter((d) => d === "e9")).toHaveLength(0);
			ready = true;
			client.emit(Discord.Events.ClientReady, client);
			await Bun.sleep(10);
			expect(dms.filter((d) => d === "e9")).toHaveLength(1);
		} finally {
			ready = true;
		}
	});

	test("the first delivery sends the receipt even when an earlier attempt already granted", async () => {
		// A crash after the grant but before `notified` was set
		const pack = productById("emotes_party_pack")!;
		const p = await Purchase.create({ userId: "e10", productId: pack.id, provider: "razorpay", amount: 14900 });
		await payments.grant("e10", pack, "razorpay:pay_e10");
		const body = paidEvent(String(p._id), "pay_e10", 14900);
		expect(await payments.handleRazorpayWebhook(body, sign(body))).toBe(200);
		expect(await payments.handleRazorpayWebhook(body, sign(body))).toBe(200);
		expect(dms.filter((d) => d === "e10")).toHaveLength(1);
		expect(await Purchase.findById(p._id)).toMatchObject({ status: "paid", notified: true });
	});

	test("refund then rebuy works", async () => {
		await pay("e6", "pay_e6a");
		await refund("pay_e6a");
		expect(await items("e6")).toEqual([]);
		await pay("e6", "pay_e6b");
		expect(await items("e6")).toEqual([...PACK].sort());
		expect(dms.filter((d) => d === "e6")).toHaveLength(2);
	});

	test("cosmetic refund removes only that purchase's rows", async () => {
		const pack = productById("emotes_party_pack")!;
		// e2 already bought moonwalk with gems, and owns a second pack's rows under another payment
		await Ownership.create({ userId: "e2", itemId: "moonwalk", source: "gems" });
		await payments.grant("e2", pack, "razorpay:pay_e2");
		expect(await items("e2")).toEqual([...PACK].sort());
		expect(await Ownership.countDocuments({ userId: "e2", sourceKey: /^razorpay:pay_e2:/ })).toBe(4);
		await Ownership.create({ userId: "e3", itemId: "spin", source: "razorpay", sourceKey: "razorpay:pay_e3:spin" });

		const p = await Purchase.create({ userId: "e2", productId: "emotes_party_pack", provider: "razorpay", status: "paid", paymentId: "pay_e2" });
		const body = JSON.stringify({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_e2", payment_id: "pay_e2" } } } });
		expect(await payments.handleRazorpayWebhook(body, sign(body))).toBe(200);
		expect(await items("e2")).toEqual(["moonwalk"]);
		expect(await items("e3")).toEqual(["spin"]);
		expect(await Purchase.findById(p._id)).toMatchObject({ status: "refunded" });
		expect(owned.filter((u) => u === "e2").length).toBeGreaterThan(0);
	});
});
