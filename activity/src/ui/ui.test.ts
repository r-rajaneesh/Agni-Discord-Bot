import { describe, expect, test } from "bun:test";
import { FREE_EMOTES } from "@game/data/emotes";
import { CHUNK, unlockPrice } from "@game/chunks";
import { createLand, createLobby } from "@game/engine";
import type { TClientMsg, TDir, TPlayerView, TServerMsg } from "@game/protocol";
import { ClientState } from "../state";
import { CHAT_KEEP, ChatPanel } from "./chat";
import { EmotePanel } from "./emotes";
import { hotbarItems } from "./hotbar";
import { placeName } from "./hud";
import { formatINR } from "./store";
import { FakeElement, fake, installDom } from "./testDom";
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

test("the chat box keeps the newest 100 lines", () => {
	installDom();
	const parent = new FakeElement("div");
	const chat = new ChatPanel(parent as unknown as HTMLElement, () => {});
	for (let i = 0; i < 130; i++) chat.add({ t: "chat", channel: "local", from: { userId: "u", name: "u" }, text: String(i), at: i });
	const lines = fake(chat.root).all("chat-text");
	expect(lines).toHaveLength(CHAT_KEEP);
	expect(lines[0]!.textContent).toBe("30");
	expect(lines.at(-1)!.textContent).toBe("129");
});

describe("emote wheel", () => {
	function wheel(owned: string[], gems: number) {
		installDom();
		const state = new ClientState();
		state.apply({ t: "owned", items: [...FREE_EMOTES, ...owned] });
		state.apply({ t: "wallet", coins: 0, gems, inventory: {}, energy: 0 });
		const sent: TClientMsg[] = [];
		const p = new EmotePanel(state, (m) => sent.push(m));
		p.render();
		const cells = fake(p.root).all("emote");
		const cell = (name: string) => cells.find((c) => c.all("emote-name")[0]!.textContent === name)!;
		return { p, sent, cells, cell };
	}

	test("the 15 free emotes come first, then the premium ones, locked with their gem price", () => {
		const { cells } = wheel([], 0);
		expect(cells).toHaveLength(30);
		expect(cells.slice(0, 15).every((c) => !c.classList.contains("emote-locked"))).toBe(true);
		expect(cells.slice(15).every((c) => c.classList.contains("emote-locked"))).toBe(true);
		expect(cells[15]!.all("emote-price")[0]!.textContent).toBe("💎 150");
	});

	test("an unlocked emote plays and closes the wheel", () => {
		const { p, sent, cell } = wheel(["moonwalk"], 0);
		let closed = false;
		p.onClose = () => void (closed = true);
		expect(cell("Moonwalk").classList.contains("emote-locked")).toBe(false);
		cell("Moonwalk").click();
		expect(sent).toEqual([{ t: "emote", id: "moonwalk" }]);
		expect(closed).toBe(true);
	});

	test("a locked emote offers gems and, when a pack has it, the pack", () => {
		const { sent, cell } = wheel([], 100);
		const buttons = (name: string) => cell(name).all("btn");
		// 100 gems: flex (75) can be bought, breakdance (150) can't
		const [flexGems, flexPack] = buttons("Flex");
		expect(flexGems!.textContent).toBe("Buy with gems");
		expect(flexPack).toBeUndefined();
		flexGems!.click();
		const [bdGems, bdPack] = buttons("Breakdance");
		expect(bdGems!.disabled).toBe(true);
		expect(bdPack!.textContent).toBe("Get pack");
		bdPack!.click();
		expect(sent).toEqual([
			{ t: "buyCosmetic", itemId: "flex", via: "gems" },
			{ t: "buyCosmetic", itemId: "breakdance", via: "razorpay" },
		]);
	});
});
