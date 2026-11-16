// Renders a sample frame to out/frame.png and benchmarks frame time.
// Usage: bun run scripts/render-frame.ts [frames]
import fs from "fs-extra";
import { DAY_MS, createWorld, joinWorld, tileKey } from "../game/engine";
import { PLOTS } from "../game/map";
import RenderManager from "../managers/RenderManager";

const frames = Number(process.argv[2] ?? 200);
const now = Date.now();
// Day 3 so crops show different growth stages
const world = createWorld("bench", now - 2 * DAY_MS - 3 * 60 * 1000);
const alice = joinWorld(world, "a", "Alice", now);
const bob = joinWorld(world, "b", "Bob", now);
const plot = PLOTS[0]!;
alice.x = plot.x + 3;
alice.y = plot.y - 1;
alice.facing = "d";
bob.x = plot.x + 5;
bob.y = plot.y - 1;
bob.facing = "l";
for (let i = 0; i < plot.w; i++) {
	world.tiles.set(tileKey(plot.x + i, plot.y), { tilled: true, cropId: "parsnip", plantedDay: 1, wateredDays: [1, 2] });
	world.tiles.set(tileKey(plot.x + i, plot.y + 1), { tilled: true, cropId: "berry", plantedDay: 1, wateredDays: [1, 3] });
	world.tiles.set(tileKey(plot.x + i, plot.y + 2), { tilled: true, cropId: "pumpkin", plantedDay: 3, wateredDays: [] });
	world.tiles.set(tileKey(plot.x + i, plot.y + 3), { tilled: true, wateredDays: [] });
}

const t0 = performance.now();
const render = new RenderManager();
console.log(`static layer: ${(performance.now() - t0).toFixed(1)}ms`);

const png = await render.renderFrame(world, "a", now);
await fs.outputFile("out/frame.png", png);
console.log(`out/frame.png ${(png.length / 1024).toFixed(1)} KiB`);

const times: number[] = [];
for (let i = 0; i < frames; i++) {
	const s = performance.now();
	await render.renderFrame(world, "a", now);
	times.push(performance.now() - s);
}
times.sort((a, b) => a - b);
const p = (q: number) => times[Math.floor(q * (times.length - 1))]!.toFixed(1);
console.log(`frames=${frames} p50=${p(0.5)}ms p95=${p(0.95)}ms max=${p(1)}ms`);
if (Number(p(0.95)) > 25) process.exitCode = 1;
