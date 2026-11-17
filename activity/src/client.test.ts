import { describe, expect, test } from "bun:test";
import { TICK_MS } from "@game/engine";
import type { TClientMsg, TPlayerView, TServerMsg } from "@game/protocol";
import { GameClient } from "./client";
import { Predictor } from "./predict";
import { ClientState } from "./state";

const view = (x = 8.5, y = 9.5): TPlayerView => ({ userId: "me", name: "me", x, y, facing: "d", equipped: "hoe", colour: "#3498db", premium: false });

function welcome(x = 8.5, y = 9.5, lobby: { n: number; label: string } | null = null): TServerMsg {
	return {
		t: "welcome",
		userId: "me",
		snapshot: {
			instance: { id: "land:me", kind: "land", seed: 42, ownerId: "me", epoch: 1000, unlocked: ["0,0"], lobby },
			tiles: [],
			players: [view(x, y)],
			you: view(x, y),
			prices: {},
		},
	};
}

function setup() {
	const state = new ClientState();
	const predictor = new Predictor(state, () => 0);
	const sent: TClientMsg[] = [];
	const calls = { start: 0, handled: [] as TServerMsg[], kicked: [] as string[] };
	const client = new GameClient({
		state,
		predictor,
		send: (m) => sent.push(m),
		start: () => calls.start++,
		handle: (_h, m) => calls.handled.push(m),
		kicked: (reason) => calls.kicked.push(reason),
	});
	return { state, predictor, client, sent, calls };
}

describe("GameClient", () => {
	test("the first welcome starts the game; later ones are handled", () => {
		const { client, calls } = setup();
		client.onStatus("ready");
		client.onMessage(welcome());
		client.onMessage(welcome(2.5, 2.5, { n: 2, label: "Public" }));
		expect(calls.start).toBe(1);
		expect(calls.handled.map((m) => m.t)).toEqual(["welcome"]);
	});

	test("after kicked every message is ignored and the game never restarts", () => {
		const { client, calls, state } = setup();
		client.onStatus("ready");
		client.onMessage({ t: "kicked", reason: "opened elsewhere" });
		client.onMessage(welcome());
		client.onMessage({ t: "toast", msg: "hi", ok: true });
		client.onMessage({ t: "kicked", reason: "again" });
		expect(calls.kicked).toEqual(["opened elsewhere"]);
		expect(calls.start).toBe(0);
		expect(calls.handled).toEqual([]);
		expect(state.you).toBeNull();
	});

	test("kicked mid-game stops input and handling", () => {
		const { client, calls, sent } = setup();
		client.onStatus("ready");
		client.onMessage(welcome());
		client.onMessage({ t: "kicked", reason: "bye" });
		client.onMessage(welcome());
		client.frame(TICK_MS, 1, 0);
		expect(calls.start).toBe(1);
		expect(calls.handled).toEqual([]);
		expect(sent).toEqual([]);
	});

	test("a repeated welcome resets the predictor as well as the state", () => {
		const { client, state, sent } = setup();
		client.onStatus("ready");
		client.onMessage(welcome());
		client.frame(TICK_MS * 4, 1, 0);
		expect(sent).toEqual([{ t: "input", seq: 1, dx: 1, dy: 0 }]);
		expect(state.you!.x).toBeGreaterThan(8.5);
		// Travel: a new instance; the four walked slices must not replay on top of it
		client.onMessage(welcome(3.5, 9.5));
		client.onMessage({ t: "you", x: 3.5, y: 9.5, facing: "d", ack: 0 });
		expect(state.you!.x).toBe(3.5);
		// The still-held key is sent again at once, with a higher seq
		client.frame(1, 1, 0);
		expect(sent.at(-1)).toEqual({ t: "input", seq: 2, dx: 1, dy: 0 });
	});

	test("you is reconciled through the predictor", () => {
		const { client, state } = setup();
		client.onStatus("ready");
		client.onMessage(welcome());
		client.frame(TICK_MS * 2, 1, 0);
		client.onMessage({ t: "you", x: 8.5, y: 9.5, facing: "r", ack: 1 });
		// One of the two slices is still pending and replays on top
		expect(state.you!.x).toBeCloseTo(8.5 + 4.5 * (TICK_MS / 1000), 9);
	});

	test("nothing is sent or walked while the connection isn't ready", () => {
		const { client, state, sent } = setup();
		client.onStatus("ready");
		client.onMessage(welcome());
		client.onStatus("closed");
		client.frame(TICK_MS * 4, 1, 0);
		client.send({ t: "lobbies" });
		expect(sent).toEqual([]);
		expect(state.you!.x).toBe(8.5);
		// Walking that started before the drop is forgotten too
		client.onStatus("ready");
		client.frame(TICK_MS, 0, 0);
		expect(state.you!.x).toBe(8.5);
	});

	test("status reports reach the caller until kicked", () => {
		const seen: string[] = [];
		const state = new ClientState();
		const client = new GameClient({
			state,
			predictor: new Predictor(state, () => 0),
			send: () => {},
			start: () => {},
			handle: () => {},
			kicked: () => {},
			status: (s) => seen.push(s),
		});
		client.onStatus("open");
		client.onMessage({ t: "kicked", reason: "x" });
		client.onStatus("closed");
		expect(seen).toEqual(["open"]);
	});
});
