import { describe, expect, test } from "bun:test";
import { MAX_MSG_BYTES, PROTOCOL_VERSION, parseClientMessage } from "../game/protocol";

const parse = (m: unknown) => parseClientMessage(typeof m === "string" ? m : JSON.stringify(m));

describe("parseClientMessage", () => {
	test("parses each valid message", () => {
		const valid = [
			{ t: "hello", v: PROTOCOL_VERSION, token: "tok", instanceId: "i1", guildId: "g1" },
			{ t: "hello", v: PROTOCOL_VERSION, token: "tok", instanceId: "i1", guildId: null },
			{ t: "input", seq: 1, dx: -1, dy: 0 },
			{ t: "chat", text: "/p hello" },
			{ t: "use", seq: 2 },
			{ t: "equip", item: "hoe" },
			{ t: "sleep" },
			{ t: "travel", to: "world" },
			{ t: "travel", to: "land" },
			{ t: "buy", item: "wheat_seed", qty: 5 },
			{ t: "sell", item: "wheat", qty: 3 },
			{ t: "sell", item: "wheat", qty: "all" },
			{ t: "unlock", cx: 2, cy: -3 },
			{ t: "buyGems", productId: "p1" },
			{ t: "lobbies" },
			{ t: "switchLobby", lobby: 2 },
			{ t: "emote", id: "wave" },
			{ t: "buyCosmetic", itemId: "hat1", via: "gems" },
			{ t: "buyCosmetic", itemId: "hat1", via: "razorpay" },
		];
		for (const m of valid) expect(parse(m)).toEqual(m as never);
	});

	test("accepts a Buffer", () => {
		expect(parseClientMessage(Buffer.from('{"t":"sleep"}'))).toEqual({ t: "sleep" });
	});

	test("rejects junk", () => {
		const junk: unknown[] = [
			"not json",
			"{}",
			"null",
			"[]",
			{ t: "nope" },
			{ t: "input", seq: 1, dx: 2, dy: 0 },
			{ t: "chat", text: "   " },
			{ t: "chat", text: "x".repeat(201) },
			{ t: "buy", item: "wheat_seed", qty: -5 },
			{ t: "buy", item: "wheat_seed", qty: 1.5 },
			{ t: "buy", item: "wheat_seed", qty: 1000 },
			{ t: "sell", item: "wheat", qty: "some" },
			{ t: "unlock", cx: 1e9, cy: 0 },
			{ t: "equip", item: "x".repeat(65) },
			{ t: "equip", item: "" },
			{ t: "travel", to: "moon" },
			{ t: "buyCosmetic", itemId: "a", via: "cash" },
			{ t: "hello", v: 1, token: "t", instanceId: "i" },
			"x".repeat(MAX_MSG_BYTES + 1),
		];
		for (const j of junk) expect(parse(j)).toBeNull();
	});

	test("strips unknown fields", () => {
		expect(parse({ t: "use", seq: 3, evil: true })).toEqual({ t: "use", seq: 3 });
	});
});
