import { expect, test } from "bun:test";
import { canvasSize, deviceScale, tintOf } from "./display";

test("deviceScale follows the screen up to 2", () => {
	expect(deviceScale(1)).toBe(1);
	expect(deviceScale(1.5)).toBe(1.5);
	expect(deviceScale(2)).toBe(2);
	expect(deviceScale(3)).toBe(2);
	expect(deviceScale(0.5)).toBe(1);
	expect(deviceScale(Number.NaN)).toBe(1);
});

test("canvasSize renders k device pixels per CSS pixel and zooms back to CSS size", () => {
	expect(canvasSize(360, 640, 2)).toEqual({ width: 720, height: 1280, zoom: 0.5 });
	expect(canvasSize(1280, 800, 1)).toEqual({ width: 1280, height: 800, zoom: 1 });
	expect(canvasSize(411, 731, 1.5)).toEqual({ width: 617, height: 1097, zoom: 1 / 1.5 });
	expect(canvasSize(0, 0, 2)).toEqual({ width: 1, height: 1, zoom: 0.5 });
});

test("tintOf reads #rrggbb and falls back to white", () => {
	expect(tintOf("#e67e22")).toBe(0xe67e22);
	expect(tintOf("#FFFFFF")).toBe(0xffffff);
	expect(tintOf("red")).toBe(0xffffff);
	expect(tintOf("#fff")).toBe(0xffffff);
	expect(tintOf("")).toBe(0xffffff);
});
