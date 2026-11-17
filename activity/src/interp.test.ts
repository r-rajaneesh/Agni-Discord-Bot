import { expect, test } from "bun:test";
import { INTERP_DELAY_MS, InterpBuffer } from "./interp";

test("the delay is 100 ms", () => {
	expect(INTERP_DELAY_MS).toBe(100);
});

test("empty buffer has no position", () => {
	expect(new InterpBuffer().sample(1000)).toBeNull();
});

test("one sample is held", () => {
	const b = new InterpBuffer();
	b.push(1000, 2, 3);
	expect(b.sample(900)).toEqual({ x: 2, y: 3 });
	expect(b.sample(5000)).toEqual({ x: 2, y: 3 });
});

test("interpolates between the samples around the time", () => {
	const b = new InterpBuffer();
	b.push(1000, 0, 0);
	b.push(1100, 2, -1);
	expect(b.sample(1050)).toEqual({ x: 1, y: -0.5 });
	expect(b.sample(1025)).toEqual({ x: 0.5, y: -0.25 });
});

test("clamps before the first and after the last sample", () => {
	const b = new InterpBuffer();
	b.push(1000, 0, 0);
	b.push(1100, 2, 0);
	expect(b.sample(500)).toEqual({ x: 0, y: 0 });
	// No extrapolation past the newest sample
	expect(b.sample(1300)).toEqual({ x: 2, y: 0 });
});

test("walks across several segments", () => {
	const b = new InterpBuffer();
	b.push(0, 0, 0);
	b.push(50, 1, 0);
	b.push(100, 1, 2);
	expect(b.sample(75)).toEqual({ x: 1, y: 1 });
});

test("old samples are dropped once a newer one is behind the sample time", () => {
	const b = new InterpBuffer();
	for (let t = 0; t <= 1000; t += 50) b.push(t, t / 100, 0);
	b.sample(900);
	// Keeps the sample at or before 900 and everything after it
	expect(b.size).toBe(3);
	expect(b.sample(925)).toEqual({ x: 9.25, y: 0 });
});

test("the buffer never grows without bound", () => {
	const b = new InterpBuffer();
	for (let t = 0; t < 1000; t++) b.push(t, t / 1000, 0);
	expect(b.size).toBeLessThanOrEqual(32);
	expect(b.sample(2000)).toEqual({ x: 0.999, y: 0 });
});

test("a sample at the same time replaces the last one", () => {
	const b = new InterpBuffer();
	b.push(100, 1, 1);
	b.push(100, 2, 2);
	expect(b.size).toBe(1);
	expect(b.sample(100)).toEqual({ x: 2, y: 2 });
});

test("snaps to a far jump instead of gliding across it", () => {
	const b = new InterpBuffer();
	b.push(0, 0, 0);
	b.push(50, 40, 0);
	expect(b.sample(25)).toEqual({ x: 40, y: 0 });
});
