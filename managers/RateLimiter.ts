const MAX_KEYS = 10_000;

/** Fixed-window counter per key (an IP address): at most `limit` takes per `windowMs` */
export default class RateLimiter {
	private limit: number;
	private windowMs: number;
	private maxKeys: number;
	private now: () => number;
	private hits = new Map<string, { start: number; count: number }>();

	constructor(opts: { limit: number; windowMs: number; maxKeys?: number; now?: () => number }) {
		this.limit = opts.limit;
		this.windowMs = opts.windowMs;
		this.maxKeys = opts.maxKeys ?? MAX_KEYS;
		this.now = opts.now ?? Date.now;
	}

	// Keys currently tracked.
	get size(): number {
		return this.hits.size;
	}

	/** Counts one hit for the key; false when it is over the limit */
	take(key: string): boolean {
		const now = this.now();
		let entry = this.hits.get(key);
		if (!entry || now - entry.start >= this.windowMs) {
			entry = { start: now, count: 0 };
			this.hits.delete(key);
			this.hits.set(key, entry);
			if (this.hits.size > this.maxKeys) this.sweep(now);
		}
		entry.count++;
		return entry.count <= this.limit;
	}

	// Drop finished windows, then the oldest keys if still over the cap.
	private sweep(now: number) {
		for (const [key, e] of this.hits) if (now - e.start >= this.windowMs) this.hits.delete(key);
		for (const key of this.hits.keys()) {
			if (this.hits.size <= this.maxKeys) break;
			this.hits.delete(key);
		}
	}
}
