import mongoose from "mongoose";

// One row per cosmetic a player owns. Free emotes have no rows.
// `sourceKey` is `<payment sourceKey>:<itemId>` for real-money grants, so a refund removes only that purchase's rows.
const OwnershipSchema = new mongoose.Schema({
	userId: { type: String, required: true },
	itemId: { type: String, required: true },
	source: { type: String, enum: ["free", "gems", "razorpay", "grant"], required: true },
	sourceKey: { type: String, unique: true, sparse: true },
	at: { type: Date, default: Date.now },
});
OwnershipSchema.index({ userId: 1, itemId: 1 }, { unique: true });

export const Ownership = mongoose.model("ownership", OwnershipSchema);

/** Records that a player owns an item; true when this call added it, false when it was already owned */
export async function own(userId: string, itemId: string, source: "gems" | "razorpay" | "grant", sourceKey?: string): Promise<boolean> {
	try {
		const r = await Ownership.updateOne(
			{ userId, itemId },
			{ $setOnInsert: { source, ...(sourceKey ? { sourceKey } : {}), at: new Date() } },
			{ upsert: true },
		);
		return r.upsertedCount > 0;
	} catch (e) {
		// A parallel upsert of the same row won
		if ((e as { code?: number }).code === 11000) return false;
		throw e;
	}
}

/** Ids of the cosmetics a player owns */
export async function ownedItems(userId: string): Promise<string[]> {
	const rows = await Ownership.find({ userId }, { itemId: 1 }).sort({ at: 1 }).lean();
	return rows.map((r) => r.itemId);
}
