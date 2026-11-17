import { describe, expect, test } from "bun:test";
import RateLimiter from "../managers/RateLimiter";

describe("RateLimiter", () => {
	test("allows the limit per key per window, then refuses until the window passes", () => {
		let now = 0;
		const rl = new RateLimiter({ limit: 3, windowMs: 60_000, now: () => now });
		expect([rl.take("a"), rl.take("a"), rl.take("a"), rl.take("a")]).toEqual([true, true, true, false]);
		// Other keys have their own budget
		expect(rl.take("b")).toBe(true);
		now += 59_999;
		expect(rl.take("a")).toBe(false);
		now += 1;
		expect(rl.take("a")).toBe(true);
	});

	test("stays bounded", () => {
		let now = 0;
		const rl = new RateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 100, now: () => now });
		for (let i = 0; i < 500; i++) rl.take(`ip${i}`);
		expect(rl.size).toBeLessThanOrEqual(100);
		now += 60_000;
		rl.take("x");
		expect(rl.size).toBeLessThanOrEqual(100);
	});
});
