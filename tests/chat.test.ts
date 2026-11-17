import { describe, expect, test } from "bun:test";
import { CHAT_RADIUS, localAudience, parseChat, sanitizeChat } from "../game/chat";
import { createLand, createLobby, enter } from "../game/engine";

describe("parseChat", () => {
	test("plain text is local, /g global, /p private", () => {
		expect(parseChat("hi")).toEqual({ kind: "say", channel: "local", text: "hi" });
		expect(parseChat("/g hi there")).toEqual({ kind: "say", channel: "global", text: "hi there" });
		expect(parseChat("/p hi")).toEqual({ kind: "say", channel: "private", text: "hi" });
	});

	test("a bare prefix is an error, and the prefix needs a space or the end", () => {
		for (const bare of ["/g", "/g ", "/p", "/p ", "/e"]) expect(parseChat(bare).kind).toBe("error");
		expect(parseChat("/g ")).toEqual({ kind: "error", msg: "Type a message after /g." });
		expect(parseChat("/party now")).toEqual({ kind: "error", msg: "Unknown command. Use /g, /p, /e, /mute or /unmute." });
		expect(parseChat("/x").kind).toBe("error");
	});

	test("/mute and /unmute take the rest of the line as a name", () => {
		expect(parseChat("/mute Bob")).toEqual({ kind: "mute", name: "Bob" });
		expect(parseChat("/unmute Big Bob")).toEqual({ kind: "unmute", name: "Big Bob" });
		expect(parseChat("/mute").kind).toBe("error");
	});

	test("control and bidi characters are stripped", () => {
		expect(sanitizeChat("a\u0000b‮c⁦d⁩e\u007Ff")).toBe("abcdef");
		expect(sanitizeChat("a\nb\tc")).toBe("a b c");
		expect(parseChat("‮‮")).toEqual({ kind: "error", msg: "Type a message." });
	});
});

describe("localAudience", () => {
	const player = (id: string, x: number) => ({ userId: id, name: id, energy: 1, lastEnergyAt: 0, equipped: "hoe", colour: "#000", x, y: 0 });
	function put(inst: ReturnType<typeof createLobby>, id: string, x: number) {
		enter(inst, player(id, 0), { x, y: 0.5, facing: "d" });
	}

	test("includes the sender and a player at exactly the radius, excludes one just past it", () => {
		const inst = createLobby(1, "Public", null, 0);
		put(inst, "me", 100.5);
		put(inst, "edge", 100.5 + CHAT_RADIUS);
		put(inst, "far", 100.5 + CHAT_RADIUS + 0.01);
		expect(localAudience(inst, "me").sort()).toEqual(["edge", "me"]);
	});

	test("only the sender's own instance counts", () => {
		const a = createLobby(1, "Public", null, 0);
		const b = createLand("land:x", "o", 1, 0);
		put(a, "me", 100.5);
		enter(b, player("other", 0), { x: 100.5, y: 0.5, facing: "d" });
		expect(localAudience(a, "me")).toEqual(["me"]);
		expect(localAudience(a, "nobody")).toEqual([]);
	});
});
