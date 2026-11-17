import { describe, expect, test } from "bun:test";
import { createLand, enter, simulate, TICK_MS, type TInstance } from "@game/engine";
import type { TClientMsg, TPlayerView, TServerMsg } from "@game/protocol";
import { Predictor, RESEND_MS } from "./predict";
import { ClientState } from "./state";

const SEED = 42;
const EPOCH = 1000;

const view = (x = 8.5, y = 9.5): TPlayerView => ({ userId: "me", name: "me", x, y, facing: "d", equipped: "hoe", colour: "#3498db", premium: false });

function welcome(x = 8.5, y = 9.5): TServerMsg {
	return {
		t: "welcome",
		userId: "me",
		snapshot: {
			instance: { id: "land:me", kind: "land", seed: SEED, ownerId: "me", epoch: EPOCH, unlocked: ["0,0"], lobby: null },
			tiles: [],
			players: [view(x, y)],
			you: view(x, y),
			prices: {},
		},
	};
}

// The server side: the same engine, one simulate per tick with the latest input, one `you` per tick
class FakeServer {
	inst: TInstance = createLand("land:me", "me", SEED, EPOCH);
	seq = 0;
	input: { dx: -1 | 0 | 1; dy: -1 | 0 | 1 } | null = null;

	constructor(x = 8.5, y = 9.5) {
		this.inst.unlocked = new Set(["0,0"]);
		enter(this.inst, { userId: "me", name: "me", energy: 100, lastEnergyAt: 0, equipped: "hoe", colour: "#3498db" }, { x, y, facing: "d" });
	}

	receive(m: TClientMsg | null) {
		if (m?.t !== "input" || m.seq <= this.seq) return;
		this.seq = m.seq;
		this.input = { dx: m.dx, dy: m.dy };
	}

	tick(now: number): Extract<TServerMsg, { t: "you" }> {
		const p = this.inst.players.get("me")!;
		if (this.input) simulate(this.inst, "me", this.input.dx, this.input.dy, TICK_MS, now);
		return { t: "you", x: p.x, y: p.y, facing: p.facing, ack: this.seq };
	}
}

function setup(x = 8.5, y = 9.5) {
	let t = 5000;
	const state = new ClientState();
	state.apply(welcome(x, y));
	const pred = new Predictor(state, () => t);
	return { state, pred, clock: { get: () => t, add: (ms: number) => (t += ms) } };
}

describe("Predictor", () => {
	test("setInput returns msg only on change or after 100 ms", () => {
		const { pred, clock } = setup();
		const a = pred.setInput(1, 0);
		expect(a).toEqual({ t: "input", seq: 1, dx: 1, dy: 0 });
		expect(pred.setInput(1, 0)).toBeNull();
		clock.add(RESEND_MS - 1);
		expect(pred.setInput(1, 0)).toBeNull();
		clock.add(1);
		expect(pred.setInput(1, 0)).toEqual({ t: "input", seq: 2, dx: 1, dy: 0 });
		// A change goes out at once
		expect(pred.setInput(1, 1)).toEqual({ t: "input", seq: 3, dx: 1, dy: 1 });
		expect(pred.setInput(0, 0)).toEqual({ t: "input", seq: 4, dx: 0, dy: 0 });
		// Standing still is not repeated: the server stops a stale input anyway
		clock.add(RESEND_MS * 5);
		expect(pred.setInput(0, 0)).toBeNull();
	});

	test("advance matches server simulate for the same inputs", () => {
		const { state, pred, clock } = setup();
		const server = new FakeServer();
		const moves: [-1 | 0 | 1, -1 | 0 | 1][] = [[1, 0], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [0, -1], [0, 0], [1, -1]];
		for (const [dx, dy] of moves) {
			server.receive(pred.setInput(dx, dy));
			// Uneven frame times: the predictor still steps in whole ticks
			pred.advance(TICK_MS * 0.6);
			pred.advance(TICK_MS * 0.4);
			server.tick(clock.get());
			clock.add(TICK_MS);
		}
		const p = server.inst.players.get("me")!;
		expect(state.you!.x).toBeCloseTo(p.x, 9);
		expect(state.you!.y).toBeCloseTo(p.y, 9);
		expect(state.you!.facing).toBe(p.facing);
		expect(state.you!.x).not.toBe(8.5);
	});

	test("advance keeps the leftover time for the next tick", () => {
		const { state, pred } = setup();
		pred.setInput(1, 0);
		pred.advance(TICK_MS - 1);
		expect(state.you!.x).toBe(8.5);
		pred.advance(1);
		expect(state.you!.x).toBeGreaterThan(8.5);
	});

	test("reconcile with no mismatch leaves position unchanged", () => {
		const { state, pred, clock } = setup();
		const server = new FakeServer();
		// The input reaches the server after two client ticks; its replies arrive two ticks after that
		const sent = pred.setInput(1, 0);
		const replies: Extract<TServerMsg, { t: "you" }>[] = [];
		for (let i = 0; i < 6; i++) {
			pred.advance(TICK_MS);
			if (i === 1) server.receive(sent);
			replies.push(server.tick(clock.get()));
			clock.add(TICK_MS);
		}
		const before = { x: state.you!.x, y: state.you!.y };
		for (const r of replies.slice(0, 4)) {
			state.apply(r);
			pred.reconcile(r);
			expect(state.you!.x).toBeCloseTo(before.x, 9);
			expect(state.you!.y).toBeCloseTo(before.y, 9);
		}
	});

	test("reconcile after a server correction replays pending inputs to the right spot", () => {
		const { state, pred, clock } = setup();
		pred.setInput(1, 0);
		pred.advance(TICK_MS * 4);
		clock.add(TICK_MS * 4);
		// The server ran one tick of seq 1, but from somewhere else (a correction)
		const fix: Extract<TServerMsg, { t: "you" }> = { t: "you", x: 10.25, y: 11.5, facing: "r", ack: 1 };
		state.apply(fix);
		pred.reconcile(fix);
		// Three ticks of walking right are still unacknowledged
		const check = new FakeServer(10.25, 11.5);
		check.input = { dx: 1, dy: 0 };
		for (let i = 0; i < 3; i++) check.tick(clock.get());
		const p = check.inst.players.get("me")!;
		expect(state.you!.x).toBeCloseTo(p.x, 9);
		expect(state.you!.y).toBeCloseTo(11.5, 9);
	});

	test("reconcile drops inputs older than the ack", () => {
		const { state, pred, clock } = setup();
		pred.setInput(1, 0);
		pred.advance(TICK_MS * 2);
		clock.add(TICK_MS * 2);
		pred.setInput(0, 1);
		pred.advance(TICK_MS);
		// Seq 2 is applied once: everything is acknowledged, so the server position is final
		const fix: Extract<TServerMsg, { t: "you" }> = { t: "you", x: 3.5, y: 4.5, facing: "d", ack: 2 };
		state.apply(fix);
		pred.reconcile(fix);
		expect(state.you!.x).toBe(3.5);
		expect(state.you!.y).toBe(4.5);
	});

	test("reset forgets pending inputs but keeps seq rising", () => {
		const { state, pred, clock } = setup();
		pred.setInput(1, 0);
		pred.advance(TICK_MS * 4);
		// A lobby switch: a new welcome and a reset
		state.apply(welcome(2.5, 2.5));
		pred.reset();
		// No slices are left to replay on top of the server's first reply
		const r: Extract<TServerMsg, { t: "you" }> = { t: "you", x: 2.5, y: 2.5, facing: "d", ack: 1 };
		state.apply(r);
		pred.reconcile(r);
		expect(state.you!.x).toBe(2.5);
		// The server keeps the session's seq across instances, so the next input must be higher, and goes out at once
		clock.add(1);
		expect(pred.setInput(1, 0)).toEqual({ t: "input", seq: 2, dx: 1, dy: 0 });
	});

	test("drawn position moves smoothly between ticks and stays put when standing", () => {
		const { state, pred } = setup();
		expect(pred.drawn()).toEqual({ x: 8.5, y: 9.5 });
		pred.setInput(1, 0);
		pred.advance(TICK_MS);
		const after = state.you!.x;
		// Half a tick later the sprite is drawn halfway along the last step
		pred.advance(TICK_MS / 2);
		expect(pred.drawn()!.x).toBeCloseTo(8.5 + (after - 8.5) / 2, 9);
		pred.setInput(0, 0);
		pred.advance(TICK_MS);
		pred.advance(TICK_MS / 2);
		expect(pred.drawn()!.x).toBeCloseTo(state.you!.x, 9);
	});

	test("a correction moves the drawn position by the same amount", () => {
		const { state, pred } = setup();
		pred.setInput(1, 0);
		pred.advance(TICK_MS * 1.5);
		const before = pred.drawn()!.x;
		const fix: Extract<TServerMsg, { t: "you" }> = { t: "you", x: 9.5, y: 9.5, facing: "r", ack: 0 };
		state.apply(fix);
		pred.reconcile(fix);
		// Seq 1 is unacknowledged, so its slice replays on top of the corrected spot: everything shifted by +1
		expect(pred.drawn()!.x).toBeCloseTo(before + 1, 9);
	});

	test("without an instance nothing moves or throws", () => {
		const pred = new Predictor(new ClientState(), () => 0);
		pred.setInput(1, 0);
		expect(() => pred.advance(TICK_MS * 3)).not.toThrow();
		expect(() => pred.reconcile({ t: "you", x: 1, y: 1, facing: "d", ack: 1 })).not.toThrow();
	});
});
