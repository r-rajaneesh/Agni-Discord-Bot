// Real-money products. Gems are a one-way premium currency: never tradeable, never cashed out.
// Discord SKU ids come from the Developer Portal (Monetization → SKUs) via env vars.

export interface TProduct {
	id: string;
	name: string;
	description: string;
	emoji: string;
	kind: "gems" | "pass";
	gems?: number;
	/** Pass length for one-time (Razorpay) purchases; Discord subscriptions use the entitlement's end date */
	days?: number;
	/** Razorpay price in paise (INR × 100) */
	priceINR: number;
	discordSku?: string;
}

export const PRODUCTS: TProduct[] = [
	{ id: "gems_100", name: "100 Gems", description: "A pouch of gems", emoji: "💎", kind: "gems", gems: 100, priceINR: 99_00, discordSku: process.env.DISCORD_SKU_GEMS_100 },
	{ id: "gems_550", name: "550 Gems", description: "+10% bonus", emoji: "💎", kind: "gems", gems: 550, priceINR: 449_00, discordSku: process.env.DISCORD_SKU_GEMS_550 },
	{ id: "gems_1200", name: "1200 Gems", description: "+20% bonus", emoji: "💎", kind: "gems", gems: 1200, priceINR: 899_00, discordSku: process.env.DISCORD_SKU_GEMS_1200 },
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
