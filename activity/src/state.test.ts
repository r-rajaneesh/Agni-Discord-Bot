import { describe, expect, test } from "bun:test";
import { terrainAt } from "@game/engine";
import { T } from "@game/map";
import type { TPlayerView, TServerMsg, TSnapshot } from "@game/protocol";
import { LAND_GATE } from "@game/world";
import { ClientState } from "./state";

const view = (userId: string, x = 8.5, y = 9.5): TPlayerView => ({
	userId,
	name: userId,
	x,
	y,
	facing: "d",
	equipped: "hoe",
	colour: "#3498db",
	premium: false,
});

function landWelcome(over: Partial<TSnapshot["instance"]> = {}): TServerMsg {
	return {
		t: "welcome",
		userId: "me",
		snapshot: {
			instance: { id: "land:me", kind: "land", seed: 42, ownerId: "me", epoch: 1000, unlocked: ["0,0", "1,0"], lobby: null, ...over },
			tiles: [["3,4", { tilled: true, wateredDays: [] }]],
			players: [view("me"), view("bob", 2.5, 2.5)],
			you: view("me"),
			prices: {},
		},
	};
}

function worldWelcome(): TServerMsg {
	return {
		t: "welcome",
		userId: "me",
		snapshot: {
			instance: { id: "lobby:3", kind: "world", seed: 0, ownerId: null, epoch: 2000, unlocked: [], lobby: { n: 3, label: "Lobby 3" } },
			tiles: [],
			players: [view("me"), view("carol")],
			you: view("me", 0.5, 0.5),
			prices: {},
		},
	};
}

describe("ClientState.apply", () => {
	test("welcome builds the instance with unlocked as a Set", () => {
		const s = new ClientState();
		const hints = s.apply(landWelcome());
		expect(hints.redrawChunks).toBe(true);
		expect(s.userId).toBe("me");
		expect(s.instance?.kind).toBe("land");
		expect(s.instance?.id).toBe("land:me");
		expect(s.instance?.seed).toBe(42);
		expect(s.instance?.ownerId).toBe("me");
		expect(s.instance?.epoch).toBe(1000);
		expect(s.instance?.unlocked).toBeInstanceOf(Set);
		expect([...s.instance!.unlocked].sort()).toEqual(["0,0", "1,0"]);
		expect(s.instance?.tiles.get("3,4")?.tilled).toBe(true);
		expect(s.you?.userId).toBe("me");
		// Your own player is not in the others list
		expect([...s.players.keys()]).toEqual(["bob"]);
	});

	test("the client instance gives the same terrain as the server rules", () => {
		const s = new ClientState();
		s.apply(landWelcome());
		// Chunk (0,-1) is not in this snapshot's unlocked list, so it is fence
		expect(terrainAt(s.instance!, 5, -3, 0)).toBe(T.fence);
		s.apply(worldWelcome());
		expect(s.instance?.lobby?.n).toBe(3);
		expect(terrainAt(s.instance!, LAND_GATE.x, LAND_GATE.y, 0)).toBe(T.portal);
	});

	test("every welcome is a full instance change", () => {
		const s = new ClientState();
		s.apply(landWelcome());
		s.apply({ t: "player", p: view("dave") });
		const hints = s.apply(worldWelcome());
		expect(hints.redrawChunks).toBe(true);
		expect(hints.reset).toBe(true);
		expect(s.instance?.kind).toBe("world");
		expect(s.instance?.tiles.size).toBe(0);
		expect([...s.players.keys()]).toEqual(["carol"]);
		expect(s.you?.x).toBe(0.5);
	});

	test("tiles returns redrawTiles keys and a null tile deletes", () => {
		const s = new ClientState();
		s.apply(landWelcome());
		const hints = s.apply({ t: "tiles", tiles: [["3,4", null], ["5,5", { tilled: true, cropId: "wheat", plantedDay: 1, wateredDays: [1] }]] });
		expect(hints.redrawTiles).toEqual(["3,4", "5,5"]);
		expect(s.instance?.tiles.has("3,4")).toBe(false);
		expect(s.instance?.tiles.get("5,5")?.cropId).toBe("wheat");
	});

	test("chunks sets redrawChunks and replaces the unlocked set", () => {
		const s = new ClientState();
		s.apply(landWelcome());
		const hints = s.apply({ t: "chunks", unlocked: ["0,0", "1,0", "2,0"] });
		expect(hints.redrawChunks).toBe(true);
		expect(s.instance?.unlocked.has("2,0")).toBe(true);
	});

	test("player adds or moves a player and left removes it", () => {
		const s = new ClientState();
		s.apply(landWelcome());
		expect(s.apply({ t: "player", p: view("bob", 3, 4) }).players).toEqual(["bob"]);
		expect(s.players.get("bob")?.x).toBe(3);
		expect(s.apply({ t: "left", userId: "bob" }).players).toEqual(["bob"]);
		expect(s.players.has("bob")).toBe(false);
	});

	test("player about yourself updates you, not the others", () => {
		const s = new ClientState();
		s.apply(landWelcome());
		s.apply({ t: "player", p: { ...view("me"), premium: true } });
		expect(s.players.has("me")).toBe(false);
		expect(s.you?.premium).toBe(true);
	});

	test("you sets your position from the server", () => {
		const s = new ClientState();
		s.apply(landWelcome());
		s.apply({ t: "you", x: 4.25, y: 7.75, facing: "l", ack: 12 });
		expect(s.you).toMatchObject({ x: 4.25, y: 7.75, facing: "l" });
		expect(s.ack).toBe(12);
	});

	test("wallet replaces the wallet", () => {
		const s = new ClientState();
		s.apply({ t: "wallet", coins: 10, gems: 2, inventory: { wood: 3 }, energy: 80 });
		expect(s.wallet).toEqual({ coins: 10, gems: 2, inventory: { wood: 3 }, energy: 80 });
	});

	test("ents replaces the animals and hints every id added, moved or dropped", () => {
		const s = new ClientState();
		s.apply(worldWelcome());
		const hints = s.apply({ t: "ents", ents: [[1, "rabbit", 3.5, 4.5, "l"], [2, "deer", 6, 7, "d"]] });
		expect(hints.animals?.sort()).toEqual([1, 2]);
		expect(s.animals.get(1)).toEqual({ id: 1, kind: "rabbit", x: 3.5, y: 4.5, facing: "l" });
		// 2 is missing from the next list, so it is dropped
		const next = s.apply({ t: "ents", ents: [[1, "rabbit", 3, 4.5, "l"], [3, "duck", 1, 1, "u"]] });
		expect(next.animals?.sort()).toEqual([1, 2, 3]);
		expect([...s.animals.keys()].sort()).toEqual([1, 3]);
		expect(s.animals.get(1)?.x).toBe(3);
		expect(s.apply({ t: "ents", ents: [] }).animals?.sort()).toEqual([1, 3]);
		expect(s.animals.size).toBe(0);
	});

	test("a welcome drops every animal", () => {
		const s = new ClientState();
		s.apply(worldWelcome());
		s.apply({ t: "ents", ents: [[1, "rabbit", 3.5, 4.5, "l"]] });
		expect(s.apply(worldWelcome()).reset).toBe(true);
		expect(s.animals.size).toBe(0);
	});

	test("messages before the first welcome change nothing", () => {
		const s = new ClientState();
		expect(s.apply({ t: "tiles", tiles: [["1,1", null]] })).toEqual({});
		expect(s.apply({ t: "chunks", unlocked: [] })).toEqual({});
		expect(s.apply({ t: "you", x: 1, y: 1, facing: "u", ack: 1 })).toEqual({});
		expect(s.instance).toBeNull();
	});
});
