const API = "https://discord.com/api/v10";
const TTL_MS = 300_000;
const MAX_ENTRIES = 10_000;

type TUser = { id: string; name: string };
type TGuild = { id: string; name: string };
type TEntry<T> = { value: T; expires: number };

export default class ActivityAuth {
	private clientId: string;
	private clientSecret: string;
	private fetch: typeof fetch;
	private now: () => number;
	private users = new Map<string, TEntry<TUser>>();
	private guilds = new Map<string, TEntry<TGuild[]>>();

	constructor(opts: { clientId: string; clientSecret: string; fetch?: typeof fetch; now?: () => number }) {
		this.clientId = opts.clientId;
		this.clientSecret = opts.clientSecret;
		this.fetch = opts.fetch ?? fetch;
		this.now = opts.now ?? Date.now;
	}

	// Total entries held in both caches.
	get cacheSize(): number {
		return this.users.size + this.guilds.size;
	}

	async exchangeCode(code: string): Promise<{ access_token: string } | null> {
		try {
			const res = await this.fetch("https://discord.com/api/oauth2/token", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					client_id: this.clientId,
					client_secret: this.clientSecret,
					grant_type: "authorization_code",
					code,
				}).toString(),
			});
			if (!res.ok) {
				console.warn(`[ActivityAuth] token exchange failed: ${res.status}`);
				return null;
			}
			const data = (await res.json()) as { access_token?: string };
			return data.access_token ? { access_token: data.access_token } : null;
		} catch {
			console.warn("[ActivityAuth] token exchange failed: network error");
			return null;
		}
	}

	async verify(accessToken: string): Promise<TUser | null> {
		const hit = this.read(this.users, accessToken);
		if (hit) return hit;
		const data = await this.get<{ id: string; username: string; global_name?: string | null }>("/users/@me", accessToken);
		if (!data) return null;
		const user = { id: data.id, name: data.global_name ?? data.username };
		this.write(this.users, accessToken, user);
		return user;
	}

	async guild(accessToken: string, guildId: string): Promise<TGuild | null> {
		let list = this.read(this.guilds, accessToken);
		if (!list) {
			const data = await this.get<TGuild[]>("/users/@me/guilds", accessToken);
			if (!data) return null;
			list = data.map((g) => ({ id: g.id, name: g.name }));
			this.write(this.guilds, accessToken, list);
		}
		return list.find((g) => g.id === guildId) ?? null;
	}

	private async get<T>(path: string, accessToken: string): Promise<T | null> {
		try {
			const res = await this.fetch(API + path, { headers: { Authorization: `Bearer ${accessToken}` } });
			if (!res.ok) {
				console.warn(`[ActivityAuth] GET ${path} failed: ${res.status}`);
				return null;
			}
			return (await res.json()) as T;
		} catch {
			console.warn(`[ActivityAuth] GET ${path} failed: network error`);
			return null;
		}
	}

	// Drops the entry if it has expired.
	private read<T>(cache: Map<string, TEntry<T>>, key: string): T | null {
		const entry = cache.get(key);
		if (!entry) return null;
		if (entry.expires <= this.now()) {
			cache.delete(key);
			return null;
		}
		return entry.value;
	}

	private write<T>(cache: Map<string, TEntry<T>>, key: string, value: T) {
		cache.set(key, { value, expires: this.now() + TTL_MS });
		if (cache.size > MAX_ENTRIES) this.sweep(cache);
	}

	// Drop expired entries, then oldest ones if still over the cap.
	private sweep<T>(cache: Map<string, TEntry<T>>) {
		const now = this.now();
		for (const [key, entry] of cache) if (entry.expires <= now) cache.delete(key);
		for (const key of cache.keys()) {
			if (cache.size <= MAX_ENTRIES) break;
			cache.delete(key);
		}
	}
}
