import type { ServerWebSocket } from "bun";
import { sanitizeChat } from "../game/chat";
import { chunkOf, dropLand } from "../game/chunks";
import { ITEMS, STARTER_COINS, STARTER_KIT } from "../game/data/items";
import { MAX_ENERGY, TICK_MS, currentEnergy, enter, simulate, type TDir, type TInstance, type TPlayerState } from "../game/engine";
import type { TAnimal } from "../game/entities";
import {
	PROTOCOL_VERSION,
	parseClientMessage,
	type TClientMsg,
	type TPlayerView,
	type TServerMsg,
	type TSnapshot,
} from "../game/protocol";
import type { TSocketData } from "../server";
import type ActivityAuth from "./ActivityAuth";
import type EconomyManager from "./EconomyManager";
import { landIdOf, type TLocation, type TStoredPlayer } from "./InstanceStore";
import type InstanceStore from "./InstanceStore";
import type PaymentManager from "./PaymentManager";
import { ownedItems } from "./models/Cosmetics";
import { chat, type TChatCtx } from "./game/chat";
import { action, dailyGems, strike, type TActionCtx } from "./game/actions";
import { buyCosmetic, emote, ownedMsg } from "./game/cosmetics";
import Wildlife from "./game/animals";
import { indexTile, near, tilesIn, tilesNear, type TChunk, type TTileIndex } from "./game/aoi";
import Lobbies, { LOBBY_CAP } from "./game/lobbies";

export { AOI_CHUNKS } from "./game/aoi";
export { MAX_ACTIONS_PER_SEC } from "./game/actions";
export { LOBBY_CAP };
/** An input older than this stops the player */
export const INPUT_STALE_MS = 250;
const FLUSH_MS = 5000;
const LAND_UNLOAD_MS = 5 * 60_000;
const LOBBY_CLOSE_MS = 60_000;
const MAX_INVALID = 20;
/** How long shutdown waits for queued instance changes */
const SHUTDOWN_DRAIN_MS = 5000;
const PALETTE = ["#e74c3c", "#3498db", "#9b59b6", "#e67e22", "#1abc9c", "#f1c40f", "#e84393", "#2ecc71"];
const PRICE_ITEMS = Object.values(ITEMS)
	.filter((i) => i.tradeable)
	.map((i) => i.id);

export type TSocket = Pick<ServerWebSocket<TSocketData>, "data" | "send" | "close">;
type TLog = { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void };
export type TPrices = TSnapshot["prices"];

/** One loaded instance */
export interface TRuntime {
	inst: TInstance;
	sessions: Set<TSession>;
	/** Mutation queue: one async change at a time per instance */
	queue: Promise<unknown>;
	busy: number;
	/** When the last player left; null while occupied */
	emptyAt: number | null;
	changed: TTileIndex;
	/** Wild animals; lobbies only */
	wild: Wildlife | null;
}

export interface TSession {
	ws: TSocket;
	userId: string;
	rt: TRuntime;
	player: TPlayerState;
	input: { dx: -1 | 0 | 1; dy: -1 | 0 | 1; at: number } | null;
	seq: number;
	dirty: boolean;
	chunk: TChunk;
	/** Other sessions in this one's AOI; always symmetric */
	visible: Set<TSession>;
	/** Guild of the launch, when the user is a member; picks the home lobby */
	home: { id: string; name: string } | null;
	/** Last position and lobby in the open world, used when arriving from private land */
	lastWorld: { x: number; y: number; facing: TDir; lobby?: number } | null;
	/** The last `ents` list sent, as JSON, so an unchanged list is not sent again */
	ents: string;
	/** Times of the actions in the last second (rate limit) */
	actions: number[];
	/** When "Slow down." was last sent */
	slowedAt: number;
	/** Players this one muted; their chat is hidden from this player only */
	mutedIds: Set<string>;
	/** Bot-owner mute from global chat, until this time (epoch ms) */
	globalMutedUntil: number;
	lastChatAt: number;
	lastGlobalAt: number;
	/** Premium cosmetics this player owns (free emotes are not listed) */
	owned: Set<string>;
	/** When the last emote played, and when its "Slow down." was last sent */
	emoteAt: number;
	emoteSlowedAt: number;
}

interface TConn {
	ws: TSocket;
	state: "new" | "pending" | "ready" | "closed";
	invalid: number;
	session?: TSession;
}

export interface TGameServerDeps {
	store: InstanceStore;
	auth: Pick<ActivityAuth, "verify" | "guild">;
	eco: EconomyManager;
	payments: Pick<PaymentManager, "hasPass" | "createRazorpayLink" | "razorpayEnabled">;
	dm: (userId: string, content: string) => Promise<void>;
	log: TLog;
	now?: () => number;
	/** Random rolls (the ore gem); tests make them deterministic */
	rand?: () => number;
	/** False in tests, which call tick() themselves */
	autoTick?: boolean;
}

const colourOf = (userId: string) => {
	let h = 0;
	for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) | 0;
	return PALETTE[Math.abs(h) % PALETTE.length] as string;
};

/** Real-time game: sessions, instances (private lands and public lobbies), the movement tick and AOI broadcast. */
export default class GameServer {
	private deps: TGameServerDeps;
	private now: () => number;
	private timer: ReturnType<typeof setInterval> | null = null;
	private worldEpoch: number;
	private lastFlush: number;
	private conns = new Map<string, TConn>();
	private sessions = new Map<string, TSession>();
	private instances = new Map<string, TRuntime>();
	/** Owner id → land being loaded or loaded */
	private lands = new Map<string, Promise<TRuntime>>();
	private lobbies: Lobbies<TRuntime>;
	/** Hellos for one user run one at a time */
	private userLocks = new Map<string, Promise<unknown>>();
	/** Player saves run in order, so an older position never overwrites a newer one */
	private saves: Promise<void> = Promise.resolve();
	private ctx: TActionCtx;
	private chatCtx: TChatCtx;

	constructor(deps: TGameServerDeps) {
		this.deps = deps;
		this.now = deps.now ?? Date.now;
		this.worldEpoch = this.now();
		this.lastFlush = this.now();
		this.lobbies = new Lobbies((inst) => this.runtime(inst), this.worldEpoch);
		this.ctx = {
			deps,
			now: this.now,
			rand: deps.rand ?? Math.random,
			linkSentAt: new Map(),
			send: (ws, msg) => this.send(ws, msg),
			toast: (s, msg, ok) => this.toast(s, msg, ok),
			run: (rt, fn) => this.run(rt, fn),
			here: (s, rt) => this.sessions.get(s.userId) === s && s.rt === rt,
			tilesChanged: (inst, keys) => this.tilesChanged(inst, keys),
			pushWallet: (userId) => this.pushWallet(userId),
			view: (s) => this.view(s),
			prices: () => this.prices(),
			land: (ownerId) => this.land(ownerId),
			worldFor: (s) => {
				const n = s.lastWorld?.lobby;
				const kept = n === undefined ? undefined : this.lobbies.get(n);
				return kept && kept.inst.players.size < LOBBY_CAP ? kept : this.lobbies.pick(s.home);
			},
			leave: (s) => this.leave(s),
			place: (s, rt, base, at, prices) => this.place(s, rt, base, at, prices),
		};
		this.chatCtx = {
			deps,
			now: this.now,
			send: (ws, msg) => this.send(ws, msg),
			toast: (s, msg, ok) => this.toast(s, msg, ok),
			sessions: () => this.sessions.values(),
			emote: (s, id) => emote(this.ctx, s, id),
		};
		if (deps.autoTick !== false) this.timer = setInterval(() => this.tick(), TICK_MS);
	}

	/** A loaded instance by id (tests and later tasks) */
	instance(id: string): TInstance | undefined {
		return this.instances.get(id)?.inst;
	}

	// ---------- sockets ----------

	open(ws: TSocket): void {
		this.conns.set(ws.data.connId, { ws, state: "new", invalid: 0 });
	}

	close(ws: TSocket): void {
		const conn = this.conns.get(ws.data.connId);
		if (!conn) return;
		this.conns.delete(ws.data.connId);
		conn.state = "closed";
		if (conn.session) this.endSession(conn.session);
	}

	async message(ws: TSocket, raw: string | Buffer): Promise<void> {
		const conn = this.conns.get(ws.data.connId);
		if (!conn || conn.state === "closed") return;
		try {
			const m = parseClientMessage(raw);
			if (conn.state !== "ready") {
				// Until hello is verified a socket may send nothing else
				if (conn.state === "new" && m?.t === "hello") {
					conn.state = "pending";
					return await this.hello(conn, m);
				}
				if (conn.state === "pending") return this.drop(conn, 1008, "wait for welcome", "wait for welcome");
				return this.drop(conn, 1008, "hello first");
			}
			const s = conn.session!;
			if (!m || m.t === "hello") {
				if (++conn.invalid >= MAX_INVALID) this.drop(conn, 1008, "too many invalid messages");
				return;
			}
			await this.handle(s, m);
		} catch (e) {
			this.deps.log.error("[GAME] message failed", e);
		}
	}

	private handle(s: TSession, m: Exclude<TClientMsg, { t: "hello" }>): Promise<void> | void {
		switch (m.t) {
			case "input":
				if (m.seq <= s.seq) return;
				s.seq = m.seq;
				s.input = { dx: m.dx, dy: m.dy, at: this.now() };
				return;
			case "lobbies":
				return this.send(s.ws, this.lobbies.list(s.rt.inst.lobby?.n ?? null));
			case "switchLobby":
				return this.switchLobby(s, m.lobby);
			case "chat":
				return chat(this.chatCtx, s, m.text);
			case "emote":
				return emote(this.ctx, s, m.id);
			case "buyCosmetic":
				return buyCosmetic(this.ctx, s, m.itemId, m.via);
			case "use":
			case "equip":
			case "sleep":
			case "travel":
			case "buy":
			case "sell":
			case "unlock":
			case "buyProduct":
				return action(this.ctx, s, m);
			default: {
				// Every message type is handled above; a new one fails to compile here
				const unhandled: never = m;
				return unhandled;
			}
		}
	}

	private send(ws: TSocket, msg: TServerMsg) {
		try {
			ws.send(JSON.stringify(msg));
		} catch {
			// socket already gone
		}
	}

	private toast(s: TSession, msg: string, ok: boolean) {
		this.send(s.ws, { t: "toast", msg, ok });
	}

	/** Closes a socket we no longer serve, after an optional kicked message */
	private drop(conn: TConn, code: number, reason: string, kicked?: string) {
		if (conn.state === "closed") return;
		if (kicked) this.send(conn.ws, { t: "kicked", reason: kicked });
		this.conns.delete(conn.ws.data.connId);
		conn.state = "closed";
		if (conn.session) this.endSession(conn.session);
		try {
			conn.ws.close(code, reason);
		} catch {
			// already closed
		}
	}

	// ---------- hello ----------

	private async hello(conn: TConn, m: Extract<TClientMsg, { t: "hello" }>) {
		try {
			if (m.v !== PROTOCOL_VERSION) return this.drop(conn, 4000, "outdated client", "outdated client");
			const user = await this.deps.auth.verify(m.token);
			if (!user) return this.drop(conn, 4001, "unauthorized", "unauthorized");
			const home = m.guildId ? await this.deps.auth.guild(m.token, m.guildId) : null;
			await this.forUser(user.id, () => this.join(conn, user, home));
		} catch (e) {
			this.deps.log.error("[GAME] hello failed", e);
			this.drop(conn, 1011, "server error", "server error");
		}
	}

	private forUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
		const prev = this.userLocks.get(userId) ?? Promise.resolve();
		const run = prev.then(fn);
		const tail = run.catch(() => {});
		this.userLocks.set(userId, tail);
		void tail.then(() => {
			if (this.userLocks.get(userId) === tail) this.userLocks.delete(userId);
		});
		return run;
	}

	private async join(conn: TConn, user: { id: string; name: string }, home: { id: string; name: string } | null) {
		const userId = user.id;
		// A live session is fresher than the database
		const old = this.sessions.get(userId);
		// Saves of a session that just closed land before the reload
		if (!old) await this.saves;
		const stored = old ? null : await this.deps.store.loadPlayer(userId);
		if (!old && !stored) {
			const r = await this.deps.eco.transact([{ userId, coins: STARTER_COINS, items: STARTER_KIT }], {
				reason: "starter",
				idempotencyKey: `starter:${userId}`,
			});
			if (!r.ok) this.deps.log.warn(`[GAME] starter grant failed for ${userId}: ${r.message}`);
		}
		const muted = old
			? { mutedIds: [...old.mutedIds], globalMutedUntil: old.globalMutedUntil }
			: await this.deps.store.loadChatState(userId).catch(() => ({ mutedIds: [] as string[], globalMutedUntil: 0 }));
		const premium = await this.deps.payments.hasPass(userId).catch(() => false);
		const owned = await ownedItems(userId).catch((e: unknown) => {
			this.deps.log.error("[GAME] loading cosmetics failed", e);
			return [] as string[];
		});
		const prices = await this.prices();
		const kind = old ? old.rt.inst.kind : (stored?.location.instanceKind ?? "land");
		// Last await: nothing can unload the land before the player is placed
		const rt = kind === "land" ? await this.land(userId) : null;
		if (conn.state === "closed") return;

		// The old session may have moved, switched instance or closed during the awaits
		const current = this.sessions.get(userId);
		const src = current ?? old;
		const prev = src?.player ?? stored;
		const base: Omit<TPlayerState, "x" | "y" | "facing"> = {
			userId,
			// Sanitized once here, so chat, mutes and labels all see the same plain name
			name: sanitizeChat(user.name) || "Player",
			energy: prev?.energy ?? MAX_ENERGY,
			lastEnergyAt: prev?.lastEnergyAt ?? this.now(),
			equipped: prev?.equipped ?? "hoe",
			colour: prev?.colour ?? colourOf(userId),
			premium,
		};
		let lastWorld = src?.lastWorld ?? null;
		if (stored?.location.instanceKind === "world")
			lastWorld = { x: stored.x, y: stored.y, facing: stored.facing, ...(stored.location.lobby === undefined ? {} : { lobby: stored.location.lobby }) };
		// Only a position on the same kind of instance is reused
		const at = prev && (src ? src.rt.inst.kind : kind) === kind ? { x: prev.x, y: prev.y, facing: prev.facing } : undefined;
		// Leaves first, so the old session's slot doesn't count against its lobby
		if (current) this.drop(this.connOf(current), 4002, "opened elsewhere", "opened elsewhere");

		// The current or saved lobby while it is open and has room, else the placement rules
		const n = src ? src.rt.inst.lobby?.n : stored?.location.lobby;
		const kept = n === undefined ? undefined : this.lobbies.get(n);
		const dest = rt ?? (kept && kept.inst.players.size < LOBBY_CAP ? kept : this.lobbies.pick(home));
		const s: TSession = {
			ws: conn.ws,
			userId,
			rt: dest,
			player: undefined as unknown as TPlayerState,
			input: null,
			seq: 0,
			dirty: true,
			chunk: { cx: 0, cy: 0 },
			visible: new Set(),
			home,
			lastWorld,
			ents: "[]",
			actions: [],
			slowedAt: -Infinity,
			mutedIds: new Set(muted.mutedIds),
			globalMutedUntil: muted.globalMutedUntil,
			lastChatAt: -Infinity,
			lastGlobalAt: -Infinity,
			owned: new Set(owned),
			emoteAt: -Infinity,
			emoteSlowedAt: -Infinity,
		};
		conn.ws.data.userId = userId;
		conn.state = "ready";
		conn.session = s;
		this.sessions.set(userId, s);
		this.place(s, dest, base, at, prices);
		await dailyGems(this.ctx, s);
		await this.pushWallet(userId);
	}

	// A live session always has its connection: drop() and close() end the session when they remove it
	private connOf(s: TSession): TConn {
		const conn = this.conns.get(s.ws.data.connId);
		if (!conn) throw new Error(`session without connection: ${s.userId}`);
		return conn;
	}

	private async prices(): Promise<TPrices> {
		const all = await this.deps.eco.npcPrices(PRICE_ITEMS);
		return Object.fromEntries(Object.entries(all).map(([id, p]) => [id, { buy: p.buy, sell: p.sell }]));
	}

	// ---------- instances ----------

	private runtime(inst: TInstance): TRuntime {
		const wild = inst.kind === "world" ? new Wildlife(inst) : null;
		const rt: TRuntime = { inst, sessions: new Set(), queue: Promise.resolve(), busy: 0, emptyAt: this.now(), changed: new Map(), wild };
		for (const key of inst.tiles.keys()) indexTile(rt.changed, inst.tiles, key);
		this.instances.set(inst.id, rt);
		return rt;
	}

	/** Runs one change on an instance after the ones before it; the instance stays loaded meanwhile */
	private run<T>(rt: TRuntime, fn: () => T | Promise<T>): Promise<T> {
		rt.busy++;
		const result = rt.queue.then(fn);
		rt.queue = result.catch(() => {}).finally(() => rt.busy--);
		return result;
	}

	private land(ownerId: string): Promise<TRuntime> {
		let p = this.lands.get(ownerId);
		if (!p) {
			p = this.deps.store.getOrCreateLand(ownerId).then((inst) => this.runtime(inst));
			this.lands.set(ownerId, p);
			p.catch(() => this.lands.delete(ownerId));
		}
		return p;
	}

	private async switchLobby(s: TSession, n: number) {
		const check = () => {
			const rt = this.lobbies.get(n);
			if (!rt) return `No lobby #${n}.`;
			if (rt === s.rt) return `You're already in lobby #${n}.`;
			if (rt.inst.players.size >= LOBBY_CAP) return `Lobby #${n} is full.`;
			return rt;
		};
		const first = check();
		if (typeof first === "string") return this.toast(s, first, false);
		try {
			const prices = await this.prices();
			await this.run(first, () => {
				if (this.sessions.get(s.userId) !== s) return;
				const rt = check();
				if (typeof rt === "string") return this.toast(s, rt, false);
				const p = s.player;
				const at = s.rt.inst.kind === "world" ? { x: p.x, y: p.y, facing: p.facing } : (s.lastWorld ?? undefined);
				const { x: _x, y: _y, facing: _f, ...base } = p;
				this.leave(s);
				this.place(s, rt, base, at, prices);
				s.dirty = true;
			});
		} catch (e) {
			this.deps.log.error("[GAME] switchLobby failed", e);
			this.toast(s, "Couldn't switch lobby. Try again.", false);
		}
	}

	/** Puts a session's player into an instance and sends the snapshot */
	private place(
		s: TSession,
		rt: TRuntime,
		base: Omit<TPlayerState, "x" | "y" | "facing">,
		at: { x: number; y: number; facing: TDir } | undefined,
		prices: TPrices,
	) {
		s.player = enter(rt.inst, base, at);
		s.rt = rt;
		s.input = null;
		// The client drops its animals on welcome
		s.ents = "[]";
		rt.sessions.add(s);
		rt.emptyAt = null;
		s.chunk = chunkOf(s.player.x, s.player.y);
		const view = this.view(s);
		for (const o of rt.sessions) {
			if (o === s || !near(o.chunk, s.chunk)) continue;
			s.visible.add(o);
			o.visible.add(s);
			this.send(o.ws, { t: "player", p: view });
		}
		const { inst } = rt;
		const snapshot: TSnapshot = {
			instance: {
				id: inst.id,
				kind: inst.kind,
				seed: inst.seed,
				ownerId: inst.ownerId,
				epoch: inst.epoch,
				unlocked: [...inst.unlocked],
				lobby: inst.lobby ? { n: inst.lobby.n, label: inst.lobby.label } : null,
			},
			tiles: tilesIn(rt.changed, inst.tiles, (c) => near(c, s.chunk)),
			players: [...s.visible].map((o) => this.view(o)),
			you: view,
			prices,
		};
		this.send(s.ws, { t: "welcome", userId: s.userId, snapshot });
		this.send(s.ws, ownedMsg(s));
	}

	/** Takes a session's player out of its instance */
	private leave(s: TSession) {
		const { rt, player: p } = s;
		if (rt.inst.lobby) s.lastWorld = { x: p.x, y: p.y, facing: p.facing, lobby: rt.inst.lobby.n };
		rt.inst.players.delete(s.userId);
		rt.sessions.delete(s);
		for (const o of s.visible) {
			o.visible.delete(s);
			this.send(o.ws, { t: "left", userId: s.userId });
		}
		s.visible.clear();
		if (rt.inst.players.size === 0) rt.emptyAt = this.now();
	}

	private endSession(s: TSession) {
		if (this.sessions.get(s.userId) !== s) return;
		this.sessions.delete(s.userId);
		const saved = this.stored(s);
		this.leave(s);
		this.save([saved]);
	}

	// ---------- tiles and AOI ----------

	/** Records changed tiles and sends them to the players whose AOI covers them (used by actions) */
	tilesChanged(inst: TInstance, keys: string[]): void {
		const rt = this.instances.get(inst.id);
		if (!rt) return;
		for (const key of keys) indexTile(rt.changed, inst.tiles, key);
		for (const s of rt.sessions) {
			const tiles = tilesNear(keys, inst.tiles, s.chunk);
			if (tiles.length) this.send(s.ws, { t: "tiles", tiles });
		}
	}

	private view(s: TSession): TPlayerView {
		const p = s.player;
		return { userId: p.userId, name: p.name, x: p.x, y: p.y, facing: p.facing, equipped: p.equipped, colour: p.colour, premium: !!p.premium };
	}

	// ---------- tick ----------

	tick(): void {
		try {
			const now = this.now();
			const movers: TSession[] = [];
			for (const s of this.sessions.values()) {
				const i = s.input;
				if (!i || now - i.at >= INPUT_STALE_MS) continue;
				const p = s.player;
				const { x, y, facing } = p;
				simulate(s.rt.inst, s.userId, i.dx, i.dy, TICK_MS, now);
				// Exactly one `you` per simulated tick, even when blocked or the input is zero:
				// the client predictor (activity/src/predict.ts) counts them to know which of its steps the server ran
				this.send(s.ws, { t: "you", x: p.x, y: p.y, facing: p.facing, ack: s.seq });
				if (p.x === x && p.y === y && p.facing === facing) continue;
				s.dirty = true;
				movers.push(s);
			}
			for (const s of movers) this.moved(s);
			this.tickAnimals(now);
			this.sweep(now);
			if (now - this.lastFlush >= FLUSH_MS) this.flush();
		} catch (e) {
			this.deps.log.error("[GAME] tick failed", e);
		}
	}

	// Sends the move to players in AOI, and updates who sees whom and which tiles are known
	private moved(s: TSession) {
		const c = chunkOf(s.player.x, s.player.y);
		if (c.cx !== s.chunk.cx || c.cy !== s.chunk.cy) {
			const prev = s.chunk;
			s.chunk = c;
			const tiles = tilesIn(s.rt.changed, s.rt.inst.tiles, (k) => near(k, c) && !near(k, prev));
			if (tiles.length) this.send(s.ws, { t: "tiles", tiles });
		}
		const view = this.view(s);
		for (const o of s.rt.sessions) {
			if (o === s) continue;
			if (near(o.chunk, s.chunk)) {
				this.send(o.ws, { t: "player", p: view });
				if (!s.visible.has(o)) {
					s.visible.add(o);
					o.visible.add(s);
					this.send(s.ws, { t: "player", p: this.view(o) });
				}
			} else if (s.visible.has(o)) {
				s.visible.delete(o);
				o.visible.delete(s);
				this.send(o.ws, { t: "left", userId: s.userId });
				this.send(s.ws, { t: "left", userId: o.userId });
			}
		}
	}

	// Simulates animals in active chunks, then sends each lobby player the living animals in their AOI when that changed
	private tickAnimals(now: number) {
		for (const rt of this.instances.values()) {
			if (!rt.wild) continue;
			rt.wild.tick([...rt.sessions].map((s) => ({ x: s.player.x, y: s.player.y, chunk: s.chunk })), now, TICK_MS);
			for (const s of rt.sessions) {
				const ents = rt.wild.visible(s.chunk);
				const json = JSON.stringify(ents);
				if (json === s.ents) continue;
				s.ents = json;
				this.send(s.ws, { t: "ents", ents });
			}
		}
	}

	/** Loaded animals of an instance, dead ones included (tests and later tasks) */
	animals(instanceId: string): TAnimal[] {
		return this.instances.get(instanceId)?.wild?.all() ?? [];
	}

	/**
	 * Hits an animal in front of the player and credits the drops when it dies (tests; players hit through `use`).
	 * Energy is charged by the engine's use(), which finds the animal.
	 */
	async hitAnimal(userId: string, animalId: number): Promise<{ ok: boolean; msg: string; drops?: Record<string, number> }> {
		const s = this.sessions.get(userId);
		if (!s?.rt.wild) return { ok: false, msg: "There's nothing to hit here." };
		const rt = s.rt;
		const r = await this.run(rt, () => (this.ctx.here(s, rt) ? strike(this.ctx, s, rt, animalId) : { ok: false, msg: "You are not here.", drops: undefined }));
		if (r.drops) await this.pushWallet(userId);
		return r;
	}

	// Unloads empty lands after 5 minutes and closes empty lobbies (except #1) after 60 s
	private sweep(now: number) {
		for (const rt of this.instances.values()) {
			const { inst } = rt;
			if (inst.players.size > 0 || rt.emptyAt === null || rt.busy > 0) continue;
			if (inst.kind === "land" && now - rt.emptyAt >= LAND_UNLOAD_MS) {
				this.instances.delete(inst.id);
				this.lands.delete(inst.ownerId!);
				dropLand(inst.seed);
			} else if (inst.lobby && inst.lobby.n !== 1 && now - rt.emptyAt >= LOBBY_CLOSE_MS) {
				this.instances.delete(inst.id);
				this.lobbies.close(inst.lobby.n);
			}
		}
	}

	// ---------- persistence ----------

	private stored(s: TSession): TStoredPlayer {
		const p = s.player;
		const { inst } = s.rt;
		const location: TLocation =
			inst.kind === "land"
				? { instanceKind: "land", landId: landIdOf(inst), x: p.x, y: p.y, facing: p.facing }
				: { instanceKind: "world", lobby: inst.lobby!.n, x: p.x, y: p.y, facing: p.facing };
		return { ...p, location };
	}

	private save(players: TStoredPlayer[], retry: TSession[] = []) {
		if (players.length === 0) return;
		this.saves = this.saves
			.then(() => this.deps.store.savePlayers(players))
			.catch((e) => {
				this.deps.log.error("[GAME] saving players failed", e);
				for (const s of retry) s.dirty = true;
			});
	}

	private flush() {
		this.lastFlush = this.now();
		const dirty = [...this.sessions.values()].filter((s) => s.dirty);
		for (const s of dirty) s.dirty = false;
		this.save(
			dirty.map((s) => this.stored(s)),
			dirty,
		);
	}

	/** Sends the player's coins, gems, inventory and energy */
	async pushWallet(userId: string): Promise<void> {
		try {
			const [w, inventory] = await Promise.all([this.deps.eco.wallet(userId), this.deps.eco.inventory(userId)]);
			const s = this.sessions.get(userId);
			if (!s) return;
			this.send(s.ws, { t: "wallet", coins: w.coins, gems: w.gems, inventory, energy: currentEnergy(s.player, this.now()) });
		} catch (e) {
			this.deps.log.error("[GAME] pushWallet failed", e);
		}
	}

	/**
	 * Sends an online player what they own after a purchase or refund. The stored items are merged in, never replacing the set,
	 * so a gem buy finishing meanwhile isn't lost; a refund names what it took in `removed`.
	 */
	async pushOwned(userId: string, removed: string[] = []): Promise<void> {
		try {
			const items = await ownedItems(userId);
			const s = this.sessions.get(userId);
			if (!s) return;
			for (const id of removed) if (!items.includes(id)) s.owned.delete(id);
			for (const id of items) s.owned.add(id);
			this.send(s.ws, ownedMsg(s));
		} catch (e) {
			this.deps.log.error("[GAME] pushOwned failed", e);
		}
	}

	/** True when the player is online or has a saved state, so energy can be refilled */
	async hasPlayed(userId: string): Promise<boolean> {
		return this.sessions.has(userId) || (await this.deps.store.hasPlayer(userId));
	}

	/** Fills the player's energy: the live session's, else the saved state (the shop's refill). False when there is neither. */
	refillEnergy(userId: string): Promise<boolean> {
		return this.forUser(userId, async () => {
			const s = this.sessions.get(userId);
			if (s) {
				s.player.energy = MAX_ENERGY;
				s.player.lastEnergyAt = this.now();
				s.dirty = true;
				await this.pushWallet(userId);
				return true;
			}
			// After the save of a session that just closed, so that save can't undo the refill
			await this.saves;
			return this.deps.store.setEnergy(userId, MAX_ENERGY, this.now());
		});
	}

	/** Mutes a player from global chat until `until` (epoch ms; a time in the past lifts it), online or not */
	async globalMute(userId: string, until: number): Promise<void> {
		await this.deps.store.setGlobalMute(userId, until);
		const s = this.sessions.get(userId);
		if (s) s.globalMutedUntil = until;
	}

	/**
	 * Closes every socket, lets queued instance changes finish (up to SHUTDOWN_DRAIN_MS), then saves every player.
	 * Sockets close with 1012 and no `kicked`, so clients reconnect to the restarted server.
	 */
	async shutdown(): Promise<void> {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		for (const conn of [...this.conns.values()]) {
			conn.session = undefined;
			this.drop(conn, 1012, "server restarting");
		}
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const drained = await Promise.race([
			Promise.all([...this.instances.values()].map((rt) => rt.queue)).then(() => true),
			new Promise<false>((r) => (timeout = setTimeout(() => r(false), SHUTDOWN_DRAIN_MS))),
		]);
		clearTimeout(timeout);
		if (!drained) this.deps.log.warn("[GAME] shutdown: instance queues still busy, saving anyway");
		this.save([...this.sessions.values()].map((s) => this.stored(s)));
		this.sessions.clear();
		for (const { inst } of this.instances.values()) if (inst.kind === "land") dropLand(inst.seed);
		this.instances.clear();
		this.lands.clear();
		await this.saves;
	}
}
