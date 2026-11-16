export interface TCrop {
	id: string;
	/** Watered days needed before harvest */
	growDays: number;
	/** Harvested item and amount */
	yieldItem: string;
	yieldQty: number;
	/** Render colour of the ripe crop */
	colour: string;
}

export const CROPS: Record<string, TCrop> = {
	parsnip: { id: "parsnip", growDays: 2, yieldItem: "parsnip", yieldQty: 1, colour: "#f2c46b" },
	wheat: { id: "wheat", growDays: 2, yieldItem: "wheat", yieldQty: 2, colour: "#e8d36a" },
	potato: { id: "potato", growDays: 3, yieldItem: "potato", yieldQty: 2, colour: "#b8875a" },
	berry: { id: "berry", growDays: 4, yieldItem: "berry", yieldQty: 3, colour: "#5b5bd6" },
	cotton: { id: "cotton", growDays: 4, yieldItem: "cotton", yieldQty: 2, colour: "#f4f4f4" },
	pumpkin: { id: "pumpkin", growDays: 6, yieldItem: "pumpkin", yieldQty: 1, colour: "#ee8a2a" },
};
