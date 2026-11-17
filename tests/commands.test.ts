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

// The gem-paid energy refill, and the Farm Pass free daily one, fill energy through the game server
describe("shop energy refill", () => {
	async function press(opts: { pass: boolean; gemsOk?: boolean; game?: boolean }) {
		const { default: shop } = await import(path.resolve("./commands/economy/shop.ts"));
		const transact: any[][] = [];
		const refills: string[] = [];
		const edits: any[] = [];
		const client = {
			config: { colours: { blurple: 0x5865f2 } },
			economy: {
				wallet: async () => ({ gems: 50, coins: 0 }),
				transact: async (...a: any[]) => {
					transact.push(a);
					return a[0].length && opts.gemsOk === false ? { ok: false, error: "insufficient_gems", message: "insufficient_gems" } : { ok: true };
				},
			},
			payments: { hasPass: async () => opts.pass, razorpayEnabled: false },
			gameServer: opts.game === false ? undefined : { refillEnergy: async (id: string) => void refills.push(id) },
			log: { error: () => {} },
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
		return { transact, refills, text: JSON.stringify(edits[0].components[0].toJSON()) };
	}

	test("debits gems, then refills", async () => {
		const r = await press({ pass: false });
		expect(r.transact).toHaveLength(1);
		expect(r.transact[0]![0]).toEqual([{ userId: "u1", gems: -10 }]);
		expect(r.refills).toEqual(["u1"]);
		expect(r.text).toContain("Energy refilled for 10");
		expect(r.text).toContain("shop:spend:energy");
	});

	test("the Farm Pass refill is free once a day", async () => {
		const r = await press({ pass: true });
		expect(r.transact).toHaveLength(1);
		expect(r.transact[0]![0]).toEqual([]);
		expect(r.transact[0]![1].idempotencyKey).toMatch(/^passrefill:u1:\d{4}-\d{2}-\d{2}$/);
		expect(r.refills).toEqual(["u1"]);
	});

	test("without enough gems nothing is refilled", async () => {
		const r = await press({ pass: false, gemsOk: false });
		expect(r.refills).toEqual([]);
		expect(r.text).toContain("Not enough gems.");
	});

	test("charges nothing while the game server is down", async () => {
		const r = await press({ pass: false, game: false });
		expect(r.transact).toHaveLength(0);
		expect(r.refills).toEqual([]);
	});
});

describe("shop", () => {
	test("sells no gems", async () => {
		const { PRODUCTS } = await import("../game/data/products");
		expect(PRODUCTS.map((p) => p.id)).toEqual(["farm_pass"]);
		expect(PRODUCTS.every((p) => p.kind === "pass")).toBe(true);
	});
});
