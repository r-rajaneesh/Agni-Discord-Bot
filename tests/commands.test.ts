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
