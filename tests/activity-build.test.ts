import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

setDefaultTimeout(60_000);
const root = path.resolve(import.meta.dir, "..");
const activity = path.join(root, "activity");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agni-build-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Runs vite from the activity folder, as `bun run activity:build` does, with a stand-in env folder
function vite(script: string) {
	const env = { ...process.env };
	delete env.VITE_DISCORD_CLIENT_ID;
	return Bun.spawnSync(["bun", "-e", script], { cwd: activity, env, stdout: "pipe", stderr: "pipe" });
}
const build = (envDir: string, outDir: string) =>
	vite(`import { build } from "vite"; await build({ envDir: ${JSON.stringify(envDir)}, logLevel: "silent", build: { outDir: ${JSON.stringify(outDir)}, emptyOutDir: true } });`);
const bundle = (outDir: string) =>
	fs.readdirSync(path.join(outDir, "assets")).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(path.join(outDir, "assets", f), "utf8")).join("\n");

describe("activity build", () => {
	test("reads env from the repo root", () => {
		const r = vite(`import { resolveConfig } from "vite"; const c = await resolveConfig({}, "build"); console.log(c.envDir);`);
		expect(r.exitCode).toBe(0);
		expect(r.stdout.toString().trim()).toBe(root);
	});

	test("bakes the client id from .env into the bundle", () => {
		const envDir = path.join(tmp, "env");
		fs.mkdirSync(envDir);
		fs.writeFileSync(path.join(envDir, ".env"), "VITE_DISCORD_CLIENT_ID=123456789012345678\nBOT_SECRET=hunter2\n");
		const outDir = path.join(tmp, "out");
		const r = build(envDir, outDir);
		expect(r.exitCode).toBe(0);
		const js = bundle(outDir);
		expect(js).toContain("123456789012345678");
		expect(js).not.toContain("hunter2");
	});

	test("fails without a client id", () => {
		const envDir = path.join(tmp, "empty");
		fs.mkdirSync(envDir);
		const r = build(envDir, path.join(tmp, "out2"));
		expect(r.exitCode).not.toBe(0);
		expect(r.stderr.toString()).toContain("VITE_DISCORD_CLIENT_ID");
	});
});
