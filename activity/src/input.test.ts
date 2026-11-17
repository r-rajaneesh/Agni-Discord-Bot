import { expect, test } from "bun:test";
import { keyDir, stickDir } from "./input";

test("arrows and WASD give 8 directions, opposite keys cancel", () => {
	expect(keyDir(new Set())).toEqual({ dx: 0, dy: 0 });
	expect(keyDir(new Set(["ArrowUp"]))).toEqual({ dx: 0, dy: -1 });
	expect(keyDir(new Set(["KeyD", "KeyS"]))).toEqual({ dx: 1, dy: 1 });
	expect(keyDir(new Set(["ArrowLeft", "KeyW"]))).toEqual({ dx: -1, dy: -1 });
	expect(keyDir(new Set(["KeyA", "KeyD", "KeyS"]))).toEqual({ dx: 0, dy: 1 });
	expect(keyDir(new Set(["KeyQ"]))).toEqual({ dx: 0, dy: 0 });
});

test("the stick snaps to 8 directions outside the dead zone", () => {
	expect(stickDir(0, 0, 10)).toEqual({ dx: 0, dy: 0 });
	expect(stickDir(5, -5, 10)).toEqual({ dx: 0, dy: 0 });
	expect(stickDir(30, 0, 10)).toEqual({ dx: 1, dy: 0 });
	expect(stickDir(0, 30, 10)).toEqual({ dx: 0, dy: 1 });
	expect(stickDir(-30, -28, 10)).toEqual({ dx: -1, dy: -1 });
	// 20° off the x axis is still straight right; 30° is a diagonal
	expect(stickDir(30 * Math.cos(0.35), -30 * Math.sin(0.35), 10)).toEqual({ dx: 1, dy: 0 });
	expect(stickDir(30 * Math.cos(0.52), -30 * Math.sin(0.52), 10)).toEqual({ dx: 1, dy: -1 });
});
