import mongoose from "mongoose";

const WalletSchema = new mongoose.Schema({
	userId: { type: String, required: true, unique: true },
	coins: { type: Number, default: 0 },
	gems: { type: Number, default: 0 },
});

const InventorySchema = new mongoose.Schema({
	userId: { type: String, required: true },
	itemId: { type: String, required: true },
	qty: { type: Number, default: 0 },
});
InventorySchema.index({ userId: 1, itemId: 1 }, { unique: true });

// Append-only. One entry per economic operation; `legs` holds every wallet/inventory change it made.
const LedgerEntrySchema = new mongoose.Schema({
	idempotencyKey: { type: String, unique: true, sparse: true },
	reason: { type: String, required: true },
	ref: String,
	legs: [
		{
			_id: false,
			userId: String,
			coins: Number,
			gems: Number,
			items: { type: Map, of: Number },
			coinsAfter: Number,
			gemsAfter: Number,
		},
	],
	at: { type: Date, default: Date.now },
});
LedgerEntrySchema.index({ "legs.userId": 1, at: -1 });

// NPC market state per item (global across guilds)
const MarketItemSchema = new mongoose.Schema({
	itemId: { type: String, required: true, unique: true },
	mid: { type: Number, required: true },
	// Current hour's candle; rolled into PriceSnapshot by the hourly job
	open: Number,
	high: Number,
	low: Number,
	volume: { type: Number, default: 0 },
});

const PriceSnapshotSchema = new mongoose.Schema({
	itemId: { type: String, required: true },
	hour: { type: Date, required: true },
	open: Number,
	high: Number,
	low: Number,
	close: Number,
	volume: Number,
});
PriceSnapshotSchema.index({ itemId: 1, hour: -1 }, { unique: true });

// Player limit orders. Escrow is taken when the order is placed.
const OrderSchema = new mongoose.Schema({
	userId: { type: String, required: true },
	itemId: { type: String, required: true },
	side: { type: String, enum: ["buy", "sell"], required: true },
	price: { type: Number, required: true },
	qty: { type: Number, required: true },
	filled: { type: Number, default: 0 },
	status: { type: String, enum: ["open", "filled", "cancelled"], default: "open" },
	at: { type: Date, default: Date.now },
});
OrderSchema.index({ itemId: 1, side: 1, status: 1, price: 1, at: 1 });
OrderSchema.index({ userId: 1, status: 1 });

// Daily earning counter for the coin faucet cap
const EarningSchema = new mongoose.Schema({
	userId: { type: String, required: true },
	day: { type: String, required: true },
	coins: { type: Number, default: 0 },
});
EarningSchema.index({ userId: 1, day: 1 }, { unique: true });

// Real-money purchases (Razorpay / Discord SKUs)
const PurchaseSchema = new mongoose.Schema({
	userId: { type: String, required: true },
	productId: { type: String, required: true },
	provider: { type: String, enum: ["razorpay", "discord"], required: true },
	status: { type: String, enum: ["pending", "paid", "refunded", "expired"], default: "pending" },
	/** razorpay payment link id / discord entitlement id */
	externalId: String,
	/** razorpay payment id once paid */
	paymentId: String,
	amount: Number,
	currency: String,
	notified: { type: Boolean, default: false },
	createdAt: { type: Date, default: Date.now },
	paidAt: Date,
});
PurchaseSchema.index({ externalId: 1 });
PurchaseSchema.index({ status: 1, notified: 1 });

// Active subscriptions (e.g. Farm Pass) from either provider
const SubscriptionSchema = new mongoose.Schema({
	userId: { type: String, required: true },
	productId: { type: String, required: true },
	provider: String,
	sourceId: { type: String, required: true, unique: true },
	endsAt: Date,
	active: { type: Boolean, default: true },
});
SubscriptionSchema.index({ userId: 1, productId: 1, active: 1 });

export const Wallet = mongoose.model("wallet", WalletSchema);
export const Inventory = mongoose.model("inventory", InventorySchema);
export const LedgerEntry = mongoose.model("ledger_entry", LedgerEntrySchema);
export const MarketItem = mongoose.model("market_item", MarketItemSchema);
export const PriceSnapshot = mongoose.model("price_snapshot", PriceSnapshotSchema);
export const Order = mongoose.model("order", OrderSchema);
export const Earning = mongoose.model("earning", EarningSchema);
export const Purchase = mongoose.model("purchase", PurchaseSchema);
export const Subscription = mongoose.model("subscription", SubscriptionSchema);
