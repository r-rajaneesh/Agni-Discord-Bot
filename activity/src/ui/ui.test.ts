import { describe, expect, test } from "bun:test";
import { CHUNK, unlockPrice } from "@game/chunks";
import { createLand, createLobby } from "@game/engine";
import type { TDir, TPlayerView, TServerMsg } from "@game/protocol";
import { ClientState } from "../state";
import { ChatBuffer, CHAT_KEEP } from "./chat";
import { hotbarItems } from "./hotbar";
import { placeName } from "./hud";
import { formatINR } from "./store";
import { unlockTarget } from "./unlock";

describe("placeName", () => {
	test("land, public and home lobbies", () => {
		expect(placeName(createLand("land:me", "me", 1, 0), "me")).toBe("Your land");
		expect(placeName(createLobby(3, "Public", null, 0), "me")).toBe("Lobby #3");
		expect(placeName(createLobby(2, "Home · Agni", "g1", 0), "me")).toBe("Home · Agni #2");
	});
});

test("hotbar: tools, then held seeds only", () => {
	expect(hotbarItems({ wheat_seed: 2, parsnip_seed: 5, parsnip: 9, pumpkin_seed: 0 })).toEqual(["hoe", "watering_can", "axe", "pickaxe", "parsnip_seed", "wheat_seed"]);
});

test("store prices are rupees from paise", () => {
	expect(formatINR(199_00)).toBe("₹199");
	expect(formatINR(49_50)).toBe("₹49.50");
});

describe("unlockTarget", () => {
	const view = (x: number, y: number, facing: TDir): TPlayerView => ({ userId: "me", name: "me", x, y, facing, equipped: "hoe", colour: "#fff", premium: false });
	function at(x: number, y: number, facing: TDir, ownerId = "me", kind: "land" | "world" = "land") {
		const s = new ClientState();
		const msg: TServerMsg = {
			t: "welcome",
			userId: "me",
			snapshot: {
				instance: { id: "land:x", kind, seed: 42, ownerId, epoch: 0, unlocked: ["-1,-1", "0,-1", "1,-1", "-1,0", "0,0", "1,0", "-1,1", "0,1", "1,1"], lobby: kind === "world" ? { n: 1, label: "Public" } : null },
				tiles: [],
				players: [],
				you: view(x, y, facing),
				prices: {},
			},
		};
		s.apply(msg);
		return s;
	}
	// The east edge of the start square: x = 2 * CHUNK is the first column of chunk (2, 0)
	const edge = 2 * CHUNK - 0.31;

	test("facing a fence at the edge of your land gives that chunk and the next price", () => {
		expect(unlockTarget(at(edge, 8.5, "r"), 0)).toEqual({ cx: 2, cy: 0, price: unlockPrice(9) });
	});

	test("nothing when not facing a locked chunk, on someone else's land, or in the world", () => {
		expect(unlockTarget(at(edge, 8.5, "l"), 0)).toBeNull();
		expect(unlockTarget(at(edge, 8.5, "r", "bob"), 0)).toBeNull();
		expect(unlockTarget(at(edge, 8.5, "r", "me", "world"), 0)).toBeNull();
	});
});

test("chat keeps the newest 100 messages", () => {
	const b = new ChatBuffer();
	for (let i = 0; i < 130; i++) b.add({ t: "chat", channel: "local", from: { userId: "u", name: "u" }, text: String(i), at: i });
	expect(b.msgs).toHaveLength(CHAT_KEEP);
	expect(b.msgs[0]!.text).toBe("30");
	expect(b.msgs.at(-1)!.text).toBe("129");
});
