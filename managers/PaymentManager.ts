import * as Discord from "discord.js";
import mongoose from "mongoose";
import Razorpay from "razorpay";
import { productById, productBySku, type TProduct } from "../game/data/products";
import type ClientManager from "./ClientManager";
import { Purchase, Subscription } from "./models/Economy";

const DAY_MS = 86_400_000;
const LINK_TTL_MS = 30 * 60 * 1000;

/**
 * Real-money purchases from Discord Premium Apps and Razorpay.
 * Both providers end in grant()/revoke(), keyed by the provider's payment id, so retries and replays are no-ops.
 */
export default class PaymentManager {
	private client: ClientManager;
	private razorpay: Razorpay | null;

	constructor(client: ClientManager) {
		this.client = client;
		this.razorpay =
			process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
				? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
				: null;
	}

	public get razorpayEnabled() {
		return !!this.razorpay;
	}

	// ---------- grant / revoke ----------

	public async grant(userId: string, product: TProduct, sourceKey: string, endsAt?: Date | null) {
		// Pass: stack on top of any active pass so renewals never lose days
		const existing = await Subscription.findOne({ sourceId: sourceKey }).lean();
		if (existing) return { ok: true as const, duplicate: true };
		const current = await Subscription.findOne({ userId, productId: product.id, active: true }).sort({ endsAt: -1 }).lean();
		const from = current?.endsAt && current.endsAt.getTime() > Date.now() ? current.endsAt.getTime() : Date.now();
		await Subscription.updateOne(
			{ sourceId: sourceKey },
			{
				$setOnInsert: {
					userId,
					productId: product.id,
					provider: sourceKey.split(":")[0],
					endsAt: endsAt === undefined ? new Date(from + (product.days ?? 30) * DAY_MS) : endsAt,
					active: true,
				},
			},
			{ upsert: true },
		);
		return { ok: true as const };
	}

	/** Refund/chargeback: ends the pass */
	public async revoke(userId: string, product: TProduct, sourceKey: string) {
		await Subscription.updateOne({ sourceId: sourceKey }, { $set: { active: false } });
	}

	public async hasPass(userId: string) {
		return !!(await Subscription.exists({
			userId,
			productId: "farm_pass",
			active: true,
			$or: [{ endsAt: null }, { endsAt: { $gt: new Date() } }],
		}));
	}

	private async notify(userId: string, product: TProduct, provider: string) {
		const user = await this.client.users.fetch(userId).catch(() => null);
		await user
			?.send({
				embeds: [
					this.client.makeEmbed({
						title: `${product.emoji} Purchase complete`,
						description: `Thanks! **${product.name}** has been added to your account (${provider}).`,
						color: this.client.config.colours.green,
					}),
				],
			})
			.catch(() => null);
	}

	// ---------- Razorpay ----------

	/** Creates a pending Purchase and a 30-minute Razorpay payment link for it */
	public async createRazorpayLink(userId: string, product: TProduct) {
		if (!this.razorpay) throw new Error("Razorpay is not configured");
		const purchase = await Purchase.create({
			userId,
			productId: product.id,
			provider: "razorpay",
			amount: product.priceINR,
			currency: "INR",
		});
		const link = await this.razorpay.paymentLink.create({
			amount: product.priceINR,
			currency: "INR",
			reference_id: String(purchase._id),
			description: `Agni: ${product.name}`,
			expire_by: Math.floor((Date.now() + LINK_TTL_MS) / 1000),
			notes: { discordUserId: userId, productId: product.id },
			// Razorpay collects contact details on the checkout page; we store none
			customer: {} as { name: string },
			callback_url: process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/paid` : undefined,
			callback_method: process.env.PUBLIC_URL ? "get" : undefined,
		});
		await Purchase.updateOne({ _id: purchase._id }, { $set: { externalId: link.id } });
		return link.short_url;
	}

	/** Verifies and applies a Razorpay webhook. Returns an HTTP status. */
	public async handleRazorpayWebhook(rawBody: string, signature: string | undefined) {
		const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
		if (!secret || !signature) return 400;
		let valid = false;
		try {
			valid = Razorpay.validateWebhookSignature(rawBody, signature, secret);
		} catch {
			valid = false;
		}
		if (!valid) {
			this.client.log.warn("[PAYMENT] Razorpay webhook with invalid signature");
			return 400;
		}
		const body = JSON.parse(rawBody);
		const event: string = body.event;
		const payment = body.payload?.payment?.entity;
		const linkEntity = body.payload?.payment_link?.entity;

		if (event === "payment_link.paid") {
			const ref = linkEntity?.reference_id;
			if (!mongoose.isValidObjectId(ref)) return 200;
			const purchase = await Purchase.findById(ref);
			const product = purchase && productById(purchase.productId);
			if (!purchase || !product) {
				this.client.log.error("[PAYMENT] Paid link with no matching purchase", { ref, paymentId: payment?.id });
				return 200;
			}
			if (payment?.amount !== product.priceINR || payment?.currency !== "INR") {
				this.client.log.error("[PAYMENT] Amount mismatch", { ref, amount: payment?.amount, expected: product.priceINR });
				return 200;
			}
			const result = await this.grant(purchase.userId, product, `razorpay:${payment.id}`);
			const fresh = result.ok && !("duplicate" in result && result.duplicate);
			// Refreshes an open Activity session
			if (fresh) await this.client.gameServer?.pushWallet(purchase.userId);
			const first = await Purchase.findOneAndUpdate(
				{ _id: purchase._id, notified: false },
				{ $set: { status: "paid", paymentId: payment.id, paidAt: new Date(), notified: true } },
			);
			if (first && fresh) await this.notify(purchase.userId, product, "Razorpay");
			this.client.log.info("[PAYMENT] Razorpay grant", { userId: purchase.userId, productId: product.id, paymentId: payment.id });
			return 200;
		}
		if (event === "refund.processed") {
			const refund = body.payload?.refund?.entity;
			const purchase = await Purchase.findOne({ paymentId: refund?.payment_id });
			const product = purchase && productById(purchase.productId);
			if (purchase && product) {
				await this.revoke(purchase.userId, product, `razorpay:${refund.payment_id}`);
				await Purchase.updateOne({ _id: purchase._id }, { $set: { status: "refunded" } });
				this.client.log.info("[PAYMENT] Razorpay refund", { userId: purchase.userId, paymentId: refund.payment_id });
			}
			return 200;
		}
		if (event === "payment_link.expired" || event === "payment_link.cancelled") {
			if (mongoose.isValidObjectId(linkEntity?.reference_id))
				await Purchase.updateOne({ _id: linkEntity.reference_id, status: "pending" }, { $set: { status: "expired" } });
			return 200;
		}
		return 200;
	}

	// ---------- Discord Premium Apps ----------

	public async handleEntitlement(entitlement: Discord.Entitlement, deleted = entitlement.deleted) {
		const product = productBySku(entitlement.skuId);
		const userId = entitlement.userId;
		if (!product || !userId) return;
		const sourceKey = `discord:${entitlement.id}`;
		if (deleted) {
			await this.revoke(userId, product, sourceKey);
			this.client.log.info("[PAYMENT] Discord entitlement revoked", { userId, sku: entitlement.skuId });
			return;
		}
		if (product.kind === "pass") {
			// Discord manages renewals; mirror its end date
			await this.grant(userId, product, sourceKey, entitlement.endsAt);
			await Subscription.updateOne({ sourceId: sourceKey }, { $set: { endsAt: entitlement.endsAt, active: entitlement.isActive() } });
			await this.client.gameServer?.pushWallet(userId);
			return;
		}
		if (entitlement.consumed) return;
		const result = await this.grant(userId, product, sourceKey);
		if (result.ok) {
			// Consume after the grant is durable; if consume fails Discord redelivers and the grant is a no-op
			await entitlement.consume().catch((e) => this.client.log.error("[PAYMENT] consume failed", e));
			await Purchase.updateOne(
				{ provider: "discord", externalId: entitlement.id },
				{ $setOnInsert: { userId, productId: product.id, status: "paid", paidAt: new Date(), notified: true } },
				{ upsert: true },
			);
			if (!("duplicate" in result && result.duplicate)) {
				await this.client.gameServer?.pushWallet(userId);
				await this.notify(userId, product, "Discord");
			}
		}
		this.client.log.info("[PAYMENT] Discord grant", { userId, sku: entitlement.skuId, entitlementId: entitlement.id });
	}

	/** Startup catch-up for consumables bought while the bot was offline */
	public async reconcileEntitlements() {
		if (!process.env.DISCORD_SKU_FARM_PASS) return;
		const unconsumed = await this.client.application?.entitlements.fetch({ excludeEnded: true }).catch(() => null);
		for (const e of unconsumed?.values() ?? []) await this.handleEntitlement(e).catch((err) => this.client.log.error(err));
	}
}
