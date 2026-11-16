import { describe, expect, test } from "bun:test";
import * as globby from "globby";
import path from "node:path";

// Every command file loads, and every slash/context builder serializes (discord.js validates limits on toJSON)
describe("commands", () => {
	const files = globby.globbySync("./commands/**/*.ts");
	test.each(files)("%s", async (file) => {
		const { default: command } = await import(path.resolve(file));
		expect(command.name).toBeTruthy();
		if (command.builder) expect(() => command.builder.toJSON()).not.toThrow();
	});

	test("component routes are unique", async () => {
		const prefixes: string[] = [];
		for (const file of files) {
			const { default: command } = await import(path.resolve(file));
			if (command.customIdPrefix) prefixes.push(command.customIdPrefix);
		}
		expect(new Set(prefixes).size).toBe(prefixes.length);
	});
});

// Until the Activity can refill energy (Task 10), the old refill button must not charge anything
describe("shop energy refill", () => {
	test("takes no gems and does not use up the Pass refill", async () => {
		const { default: shop } = await import(path.resolve("./commands/economy/shop.ts"));
		const transact: unknown[] = [];
		const edits: any[] = [];
		const client = {
			config: { colours: { blurple: 0x5865f2 } },
			economy: { wallet: async () => ({ gems: 50, coins: 0 }), transact: async (...a: unknown[]) => (transact.push(a), { ok: true }) },
			payments: { hasPass: async () => true, razorpayEnabled: false },
		};
		const interaction = {
			user: { id: "u1" },
			customId: "shop:spend:energy",
			isChatInputCommand: () => false,
			isButton: () => true,
			deferUpdate: async () => {},
			editReply: async (m: unknown) => edits.push(m),
		};
		await shop.execute({ client, interaction });
		expect(transact).toHaveLength(0);
		expect(JSON.stringify(edits[0].components[0].toJSON())).toContain("Energy refills return when Agni Valley launches as an Activity.");
		expect(JSON.stringify(edits[0].components[0].toJSON())).not.toContain("shop:spend:energy");
	});
});
