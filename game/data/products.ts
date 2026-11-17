// Real-money products. Real money buys items only: gems are earned in game, never sold,
// never tradeable and never cashed out. Discord SKU ids come from the Developer Portal via env vars.

export interface TProduct {
	id: string;
	name: string;
	description: string;
	emoji: string;
	kind: "pass";
	/** Pass length for one-time (Razorpay) purchases; Discord subscriptions use the entitlement's end date */
	days?: number;
	/** Razorpay price in paise (INR × 100) */
	priceINR: number;
	discordSku?: string;
}

export const PRODUCTS: TProduct[] = [
	{
		id: "farm_pass",
		name: "Farm Pass (30 days)",
		description: "Gold crown on your farmer and one free energy refill every day",
		emoji: "👑",
		kind: "pass",
		days: 30,
		priceINR: 199_00,
		discordSku: process.env.DISCORD_SKU_FARM_PASS,
	},
];

export const productById = (id: string) => PRODUCTS.find((p) => p.id === id);
export const productBySku = (sku: string) => PRODUCTS.find((p) => p.discordSku && p.discordSku === sku);

/** Things gems buy. Convenience and cosmetics only: gems never convert into coins. */
export const GEM_PRICES = { energyRefill: 10 };
