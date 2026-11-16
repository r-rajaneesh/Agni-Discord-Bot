// Item catalog shared by the farm game and the economy.
// Seeded from the old Agni economy simulation (wood, stone, copper, iron, gold, wheat, cotton, berry).

export type TItemCategory = "tool" | "seed" | "crop" | "resource";

export interface TItem {
	id: string;
	name: string;
	emoji: string;
	category: TItemCategory;
	/** NPC market reference price in coins. Tools have no price (not tradeable). */
	basePrice: number;
	/** Units of daily volume the NPC market absorbs before the price moves ~e (see game/market.ts) */
	liquidity: number;
	tradeable: boolean;
	/** For seeds: the crop it grows */
	cropId?: string;
}

export const ITEMS: Record<string, TItem> = {
	hoe: { id: "hoe", name: "Hoe", emoji: "⛏️", category: "tool", basePrice: 0, liquidity: 1, tradeable: false },
	watering_can: { id: "watering_can", name: "Watering Can", emoji: "🚿", category: "tool", basePrice: 0, liquidity: 1, tradeable: false },
	axe: { id: "axe", name: "Axe", emoji: "🪓", category: "tool", basePrice: 0, liquidity: 1, tradeable: false },
	pickaxe: { id: "pickaxe", name: "Pickaxe", emoji: "⚒️", category: "tool", basePrice: 0, liquidity: 1, tradeable: false },

	parsnip_seed: { id: "parsnip_seed", name: "Parsnip Seeds", emoji: "🌱", category: "seed", basePrice: 20, liquidity: 400, tradeable: true, cropId: "parsnip" },
	wheat_seed: { id: "wheat_seed", name: "Wheat Seeds", emoji: "🌱", category: "seed", basePrice: 10, liquidity: 600, tradeable: true, cropId: "wheat" },
	potato_seed: { id: "potato_seed", name: "Potato Seeds", emoji: "🌱", category: "seed", basePrice: 50, liquidity: 300, tradeable: true, cropId: "potato" },
	berry_seed: { id: "berry_seed", name: "Berry Seeds", emoji: "🌱", category: "seed", basePrice: 80, liquidity: 200, tradeable: true, cropId: "berry" },
	cotton_seed: { id: "cotton_seed", name: "Cotton Seeds", emoji: "🌱", category: "seed", basePrice: 60, liquidity: 200, tradeable: true, cropId: "cotton" },
	pumpkin_seed: { id: "pumpkin_seed", name: "Pumpkin Seeds", emoji: "🌱", category: "seed", basePrice: 100, liquidity: 150, tradeable: true, cropId: "pumpkin" },

	parsnip: { id: "parsnip", name: "Parsnip", emoji: "🥕", category: "crop", basePrice: 35, liquidity: 400, tradeable: true },
	wheat: { id: "wheat", name: "Wheat", emoji: "🌾", category: "crop", basePrice: 25, liquidity: 600, tradeable: true },
	potato: { id: "potato", name: "Potato", emoji: "🥔", category: "crop", basePrice: 80, liquidity: 300, tradeable: true },
	berry: { id: "berry", name: "Berry", emoji: "🫐", category: "crop", basePrice: 120, liquidity: 200, tradeable: true },
	cotton: { id: "cotton", name: "Cotton", emoji: "☁️", category: "crop", basePrice: 110, liquidity: 200, tradeable: true },
	pumpkin: { id: "pumpkin", name: "Pumpkin", emoji: "🎃", category: "crop", basePrice: 320, liquidity: 100, tradeable: true },

	wood: { id: "wood", name: "Wood", emoji: "🪵", category: "resource", basePrice: 5, liquidity: 1000, tradeable: true },
	stone: { id: "stone", name: "Stone", emoji: "🪨", category: "resource", basePrice: 3, liquidity: 1000, tradeable: true },
	copper: { id: "copper", name: "Copper Ore", emoji: "🟠", category: "resource", basePrice: 25, liquidity: 300, tradeable: true },
	iron: { id: "iron", name: "Iron Ore", emoji: "⚙️", category: "resource", basePrice: 60, liquidity: 200, tradeable: true },
	gold: { id: "gold", name: "Gold Ore", emoji: "🟡", category: "resource", basePrice: 250, liquidity: 50, tradeable: true },
};

export const TOOL_IDS = ["hoe", "watering_can", "axe", "pickaxe"] as const;

/** What a new player starts with */
export const STARTER_KIT: Record<string, number> = { parsnip_seed: 15 };
export const STARTER_COINS = 500;
