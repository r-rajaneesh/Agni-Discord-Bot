// Client-side prediction: our own player walks at once with the same engine the server runs,
// and every `you` from the server resets the position and replays what it has not applied yet.
import { simulate, TICK_MS, type TPlayerState } from "@game/engine";
import type { TClientMsg, TServerMsg } from "@game/protocol";
import type { ClientState } from "./state";

/** A held direction is sent again this often, well inside the server's 250 ms stale limit */
export const RESEND_MS = 100;
// After a stall (a hidden tab) only this much time is caught up; the server stopped us by then anyway
const MAX_CATCHUP_MS = 250;
// About 10 s of walking; more than that unacknowledged means the server isn't listening
const MAX_PENDING = 200;

type TAxis = -1 | 0 | 1;

interface TSlice {
	seq: number;
	dx: TAxis;
	dy: TAxis;
	now: number;
}

export class Predictor {
	// Never reset: the server keeps a session's seq across lobby switches and travel
	private seq = 0;
	private dx: TAxis = 0;
	private dy: TAxis = 0;
	private sentAt = -Infinity;
	private acc = 0;
	private pending: TSlice[] = [];
	// The last tick's step, backwards, for drawing between ticks; null when the last tick didn't move.
	// Kept relative to the position, so a correction shows at once without breaking the step being drawn.
	private back: { x: number; y: number } | null = null;

	constructor(
		private state: ClientState,
		private now: () => number,
	) {}

	/** The input message to send, when the direction changed or a held one is due again */
	setInput(dx: TAxis, dy: TAxis): TClientMsg | null {
		const t = this.now();
		const changed = dx !== this.dx || dy !== this.dy;
		// Standing still needs no repeats: the server stops a stale input by itself
		if (!changed && ((dx === 0 && dy === 0) || t - this.sentAt < RESEND_MS)) return null;
		this.dx = dx;
		this.dy = dy;
		this.sentAt = t;
		return { t: "input", seq: ++this.seq, dx, dy };
	}

	/** Walks in whole TICK_MS slices with the current input, keeping each slice until the server acknowledges it */
	advance(dtMs: number): void {
		if (!(dtMs > 0)) return;
		this.acc = Math.min(this.acc + dtMs, MAX_CATCHUP_MS);
		while (this.acc >= TICK_MS) {
			this.acc -= TICK_MS;
			this.back = null;
			if (this.dx === 0 && this.dy === 0) continue;
			const you = this.state.you;
			const slice = { seq: this.seq, dx: this.dx, dy: this.dy, now: this.now() };
			if (!you || !this.step(slice)) continue;
			this.back = { x: you.x - this.state.you!.x, y: you.y - this.state.you!.y };
			// Dropping only the oldest would skew the one-slice-per-`you` pairing; start over from the next correction
			if (this.pending.length >= MAX_PENDING) this.pending = [];
			this.pending.push(slice);
		}
	}

	/** Takes the server position, drops the slices it has applied and replays the rest */
	reconcile(m: Extract<TServerMsg, { t: "you" }>): void {
		const you = this.state.you;
		if (!you) return;
		// The server sends one `you` per tick it simulated, so each one accounts for one slice of the acked input
		let skip = 1;
		this.pending = this.pending.filter((s) => s.seq > m.ack || (s.seq === m.ack && skip-- <= 0));
		this.state.you = { ...you, x: m.x, y: m.y, facing: m.facing };
		for (const s of this.pending) this.step(s);
	}

	/** Where to draw our player: part way along the last tick's step, by the time since that tick */
	drawn(): { x: number; y: number } | null {
		const you = this.state.you;
		if (!you) return null;
		if (!this.back) return { x: you.x, y: you.y };
		const f = 1 - this.acc / TICK_MS;
		return { x: you.x + this.back.x * f, y: you.y + this.back.y * f };
	}

	/** Forgets the input and every pending slice: on a new welcome, or while the socket is not ready */
	reset(): void {
		this.dx = 0;
		this.dy = 0;
		this.sentAt = -Infinity;
		this.acc = 0;
		this.pending = [];
		this.back = null;
	}

	// One server tick of movement, applied to state.you. False when there is nothing to move.
	private step(s: TSlice): boolean {
		const { instance: inst, you, userId } = this.state;
		if (!inst || !you || !userId) return false;
		let p = inst.players.get(userId);
		if (!p) {
			// Only the fields simulate reads matter; energy lives on the server
			const body: TPlayerState = { ...you, energy: 0, lastEnergyAt: 0 };
			inst.players.set(userId, body);
			p = body;
		}
		p.x = you.x;
		p.y = you.y;
		p.facing = you.facing;
		simulate(inst, userId, s.dx, s.dy, TICK_MS, s.now);
		// A new object, so the sprite sees a facing change
		this.state.you = { ...you, x: p.x, y: p.y, facing: p.facing };
		return true;
	}
}
