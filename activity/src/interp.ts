// Other players are drawn a little in the past, between two positions the server has already sent

export const INTERP_DELAY_MS = 100;
const MAX_SAMPLES = 32;
// A move this long between two samples is a teleport, not a walk
const SNAP_DIST = 4;

interface TSample {
	t: number;
	x: number;
	y: number;
}

export class InterpBuffer {
	private samples: TSample[] = [];

	get size(): number {
		return this.samples.length;
	}

	push(t: number, x: number, y: number): void {
		const last = this.samples.at(-1);
		if (last && t <= last.t) {
			last.x = x;
			last.y = y;
			return;
		}
		this.samples.push({ t, x, y });
		if (this.samples.length > MAX_SAMPLES) this.samples.shift();
	}

	/** Position at time t. Clamps to the oldest and newest samples; never extrapolates. */
	sample(t: number): { x: number; y: number } | null {
		const s = this.samples;
		// Drop samples that a newer one at or before t has made useless
		while (s.length > 1 && s[1]!.t <= t) s.shift();
		const a = s[0];
		if (!a) return null;
		const b = s[1];
		if (!b || t <= a.t) return { x: a.x, y: a.y };
		if (Math.hypot(b.x - a.x, b.y - a.y) > SNAP_DIST) return { x: b.x, y: b.y };
		const f = (t - a.t) / (b.t - a.t);
		return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
	}
}
