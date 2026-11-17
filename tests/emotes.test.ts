import { describe, expect, test } from "bun:test";
import { parseChat } from "../game/chat";
import { EMOTES, FREE_EMOTES, canUseEmote } from "../game/data/emotes";

describe("emotes", () => {
	test("exactly 15 free emotes", () => {
		expect(FREE_EMOTES).toEqual(["wave", "nod", "shake_head", "laugh", "cry", "angry", "love", "thumbs_up", "clap", "dance", "sit", "sleep", "surprised", "thinking", "point"]);
	});

	test("every FREE_EMOTES id has gems === null and every other emote has gems > 0", () => {
		for (const id of FREE_EMOTES) expect(EMOTES[id]?.gems).toBeNull();
		const premium = Object.values(EMOTES).filter((e) => !FREE_EMOTES.includes(e.id));
		expect(premium).toHaveLength(15);
		for (const e of premium) expect(e.gems).toBeGreaterThan(0);
		expect(EMOTES.breakdance!.gems).toBe(150);
		expect(EMOTES.facepalm!.gems).toBe(50);
		for (const [id, e] of Object.entries(EMOTES)) expect(e.id).toBe(id);
	});

	test("canUseEmote allows free ids and owned premium ids only", () => {
		const owned = new Set(["moonwalk"]);
		expect(canUseEmote("wave", new Set())).toBe(true);
		expect(canUseEmote("moonwalk", owned)).toBe(true);
		expect(canUseEmote("breakdance", owned)).toBe(false);
		expect(canUseEmote("nope", new Set(["nope"]))).toBe(false);
	});

	test('parseChat("/e wave") gives the emote command', () => {
		expect(parseChat("/e wave")).toEqual({ kind: "emote", id: "wave" });
		expect(parseChat("/E Wave")).toEqual({ kind: "emote", id: "wave" });
		expect(parseChat("/e")).toEqual({ kind: "error", msg: "Type an emote after /e." });
	});
});
