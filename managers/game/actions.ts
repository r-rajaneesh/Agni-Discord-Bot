// Player actions over the websocket: use, equip, sleep, travel, buy, sell, unlock and real-money items.
// A change to an instance runs in that instance's queue and re-checks the session after every await.
import { ITEMS } from "../../game/data/items";
import { productById } from "../../game/data/products";
import {
	HIT_RADIUS,
	HOUSE_DOOR,
	facedPoint,
	facedTile,
	sleep as sleepAt,
	terrainAt,
	use as useAt,
	type TActionResult,
	type TInstance,
	type TPlayerState,
} from "../../game/engine";
import { hitAnimal } from "../../game/entities";
import { T } from "../../game/map";
import type { TClientMsg, TPlayerView, TServerMsg } from "../../game/protocol";
import type { TGameServerDeps, TPrices, TRuntime, TSession, TSocket } from "../GameServer";
import type { TLeg, TMeta } from "../EconomyManager";

export const MAX_ACTIONS_PER_SEC = 6;

export const DAILY_GEMS = 5;
/** Chance of a gem per ore mined, and the most a player finds by mining in a UTC day */
export const ORE_GEM_CHANCE = 0.01;
export const ORE_GEMS_PER_DAY = 5;
/** One payment link per product per player in this window */
export const LINK_COOLDOWN_MS = 30_000;

const ACTIONS = ["use", "equip", "sleep", "travel", "buy", "sell", "unlock", "buyProduct"] as const;
export type TAction = Extract<TClientMsg, { t: (typeof ACTIONS)[number] }>;

/** What the handlers need from the GameServer */
export interface TActionCtx {
	deps: TGameServerDeps;
	now(): number;
	rand(): number;
	/** `<userId>:<productId>` → when its payment link was last sent */
	linkSentAt: Map<string, number>;
	send(ws: TSocket, msg: TServerMsg): void;
	toast(s: TSession, msg: string, ok: boolean): void;
	run<T>(rt: TRuntime, fn: () => T | Promise<T>): Promise<T>;
	/** True while the session is live and still in that instance */
	here(s: TSession, rt: TRuntime): boolean;
	tilesChanged(inst: TInstance, keys: string[]): void;
	pushWallet(userId: string): Promise<void>;
	view(s: TSession): TPlayerView;
	prices(): Promise<TPrices>;
	land(ownerId: string): Promise<TRuntime>;
	/** The lobby a player arriving from private land goes to */
	worldFor(s: TSession): TRuntime;
	leave(s: TSession): void;
	place(s: TSession, rt: TRuntime, base: Omit<TPlayerState, "x" | "y" | "facing">, at: { x: number; y: number; facing: TPlayerState["facing"] } | undefined, prices: TPrices): void;
}

/** True when the player already sent MAX_ACTIONS_PER_SEC actions in the last second; else counts this one */
export function limited(ctx: TActionCtx, s: TSession): boolean {
	const now = ctx.now();
	s.actions = s.actions.filter((at) => now - at < 1000);
	if (s.actions.length >= MAX_ACTIONS_PER_SEC) {
		if (now - s.slowedAt >= 1000) {
			s.slowedAt = now;
			ctx.toast(s, "Slow down.", false);
		}
		return true;
	}
	s.actions.push(now);
	return false;
}

/** Runs one action, unless the player sent more than MAX_ACTIONS_PER_SEC in the last second */
export function action(ctx: TActionCtx, s: TSession, m: TAction): Promise<void> | void {
	if (limited(ctx, s)) return;
	switch (m.t) {
		case "use":
			return use(ctx, s);
		case "equip":
			return equip(ctx, s, m.item);
		case "sleep":
			return sleep(ctx, s);
		case "travel":
			return travel(ctx, s, m.to);
		case "buy":
			return trade(ctx, s, "buy", m.item, m.qty);
		case "sell":
			return trade(ctx, s, "sell", m.item, m.qty);
		case "unlock":
			return unlock(ctx, s, m.cx, m.cy);
		case "buyProduct":
			return buyProduct(ctx, s, m.productId);
	}
}

// Economy error codes that carry no message of their own
const MESSAGES: Record<string, string> = { insufficient_coins: "Not enough coins.", insufficient_gems: "Not enough gems." };
const say = (msg: string) => MESSAGES[msg] ?? msg;
const FAILED = "Something went wrong. Try again.";

/** EconomyManager.transact with readable messages; a thrown error becomes a failed result */
export async function transact(ctx: TActionCtx, legs: TLeg[], meta: TMeta): Promise<{ ok: true; duplicate?: boolean } | { ok: false; message: string }> {
	try {
		const r = await ctx.deps.eco.transact(legs, meta);
		return r.ok ? { ok: true, duplicate: !!r.duplicate } : { ok: false, message: say(r.message) };
	} catch (e) {
		ctx.deps.log.error(`[GAME] ${meta.reason} transaction failed`, e);
		return { ok: false, message: FAILED };
	}
}

const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

const negate = (items: Record<string, number>) => Object.fromEntries(Object.entries(items).map(([id, n]) => [id, -n]));

// ---------- use ----------

async function use(ctx: TActionCtx, s: TSession) {
	const rt = s.rt;
	const to = await ctx.run(rt, async (): Promise<"world" | "land" | undefined> => {
		if (!ctx.here(s, rt)) return;
		const inventory = await ctx.deps.eco.inventory(s.userId);
		if (!ctx.here(s, rt)) return;
		const animals = rt.wild
			?.all()
			.filter((a) => a.state !== "dead")
			.map(({ id, x, y }) => ({ id, x, y }));
		const r = useAt(rt.inst, s.userId, ctx.now(), inventory, animals);
		if (!r.ok) return void ctx.toast(s, r.msg, false);
		if (r.travel) return r.travel;
		if (r.menu) ctx.send(s.ws, { t: "menu", menu: r.menu });
		if (r.hitAnimalId !== undefined) return void (await useOnAnimal(ctx, s, rt, r, r.hitAnimalId));
		await applyUse(ctx, s, rt, r);
	});
	// Travel takes the player out of this instance, so it runs after the queued step
	if (to) await travel(ctx, s, to);
}

async function useOnAnimal(ctx: TActionCtx, s: TSession, rt: TRuntime, r: TActionResult, animalId: number) {
	const hit = await strike(ctx, s, rt, animalId);
	// The engine's energy cost, charged once and only for a hit that landed
	if (hit.ok && ctx.here(s, rt)) {
		r.apply?.();
		s.dirty = true;
	}
	ctx.toast(s, hit.msg, hit.ok);
	await ctx.pushWallet(s.userId);
}

// Ported from the old GameManager: debit `take`, apply(), save the tiles, credit `give`, then tell everyone
async function applyUse(ctx: TActionCtx, s: TSession, rt: TRuntime, r: TActionResult) {
	const { userId } = s;
	const { inst } = rt;
	const meta = { reason: "use", ref: inst.id };
	if (r.take) {
		const t = await transact(ctx, [{ userId, items: negate(r.take) }], meta);
		if (!t.ok) return ctx.toast(s, t.message, false);
		// Paid for: the change goes ahead even if the player left meanwhile (the instance stays loaded while queued)
	}
	r.apply?.();
	s.dirty = true;
	const keys = r.changedTiles ?? [];
	// Lobby tiles live in memory only
	if (keys.length && inst.kind === "land") await ctx.deps.store.saveTiles(inst, keys).catch((e) => ctx.deps.log.error("[GAME] saving tiles failed", e));
	if (r.give) {
		const t = await transact(ctx, [{ userId, items: r.give }], meta);
		if (!t.ok) {
			ctx.deps.log.error(`[GAME] crediting ${JSON.stringify(r.give)} to ${userId} failed: ${t.message}`);
			ctx.toast(s, "Couldn't add that to your inventory.", false);
		}
	}
	if (r.mined) await oreGem(ctx, s);
	// The tiles changed whether or not the actor is still here, so observers always get them
	if (keys.length) ctx.tilesChanged(inst, keys);
	if (r.msg && ctx.here(s, rt)) ctx.toast(s, r.msg, true);
	await ctx.pushWallet(userId);
}

/**
 * Hits an animal in front of the player and credits the drops when it dies; call inside the instance queue.
 * When the credit fails the animal gets its hp and state back, so the kill is not lost.
 */
export async function strike(ctx: TActionCtx, s: TSession, rt: TRuntime, animalId: number): Promise<{ ok: boolean; msg: string; drops?: Record<string, number> }> {
	const a = rt.wild?.find(animalId);
	const f = facedPoint(s.player);
	if (!a || a.state === "dead" || Math.hypot(a.x - f.x, a.y - f.y) > HIT_RADIUS) return { ok: false, msg: "Nothing to hit here." };
	const before = { hp: a.hp, state: a.state, until: a.until };
	const hit = hitAnimal(a, ctx.now());
	if (!hit.killed || !hit.drops) return { ok: true, msg: `You hit the ${a.kind}.` };
	const drops = hit.drops;
	const t = await transact(ctx, [{ userId: s.userId, items: drops }], { reason: "slaughter", ref: a.kind });
	if (!t.ok) {
		ctx.deps.log.error(`[GAME] slaughter credit failed for ${s.userId}: ${t.message}`);
		Object.assign(a, before);
		return { ok: false, msg: "Couldn't collect the drops." };
	}
	const got = Object.entries(drops)
		.map(([id, n]) => `${n} ${ITEMS[id]?.name ?? id}`)
		.join(", ");
	return { ok: true, msg: `🍖 +${got}`, drops };
}

// ---------- equip and sleep ----------

async function equip(ctx: TActionCtx, s: TSession, item: string) {
	const def = ITEMS[item];
	if (!def) return ctx.toast(s, "Unknown item.", false);
	const rt = s.rt;
	await ctx.run(rt, async () => {
		if (!ctx.here(s, rt)) return;
		// Tools are always at hand; anything else must be in the inventory
		if (def.category !== "tool") {
			const inventory = await ctx.deps.eco.inventory(s.userId);
			if (!ctx.here(s, rt)) return;
			if (!((inventory[item] ?? 0) > 0)) return ctx.toast(s, `You don't have any ${def.name}.`, false);
		}
		s.player.equipped = item;
		s.dirty = true;
		const view = ctx.view(s);
		ctx.send(s.ws, { t: "player", p: view });
		for (const o of s.visible) ctx.send(o.ws, { t: "player", p: view });
	});
}

async function sleep(ctx: TActionCtx, s: TSession) {
	const rt = s.rt;
	await ctx.run(rt, async () => {
		if (!ctx.here(s, rt)) return;
		const r = sleepAt(rt.inst, s.userId, ctx.now());
		if (!r.ok) return ctx.toast(s, r.msg, false);
		r.apply?.();
		s.dirty = true;
		ctx.toast(s, r.msg, true);
		await ctx.pushWallet(s.userId);
	});
}

// ---------- travel ----------

// Why the player can't go `to` from where they stand, or null when they can
function travelBlock(rt: TRuntime, p: TPlayerState, to: "world" | "land", now: number): string | null {
	const { inst } = rt;
	const f = facedTile(p);
	const portal = terrainAt(inst, f.x, f.y, now) === T.portal;
	if (to === "land") return inst.kind === "world" && portal ? null : "Use the Land Gate to go to your land.";
	const door = f.x === HOUSE_DOOR.x && f.y === HOUSE_DOOR.y;
	return inst.kind === "land" && (portal || door) ? null : "Use the portal stone or your house door to travel.";
}

/** From the Land Gate to the player's land; from the portal stone or house door back to the world where they left it */
async function travel(ctx: TActionCtx, s: TSession, to: "world" | "land") {
	const src = s.rt;
	const block = travelBlock(src, s.player, to, ctx.now());
	if (block) return ctx.toast(s, block, false);
	try {
		const prices = await ctx.prices();
		await ctx.run(src, async () => {
			if (!ctx.here(s, src)) return;
			// Last await: nothing can unload the land before the player is placed
			const land = to === "land" ? await ctx.land(s.userId) : null;
			if (!ctx.here(s, src)) return;
			const again = travelBlock(src, s.player, to, ctx.now());
			if (again) return ctx.toast(s, again, false);
			const dest = land ?? ctx.worldFor(s);
			const at = to === "world" ? (s.lastWorld ?? undefined) : undefined;
			const { x: _x, y: _y, facing: _f, ...base } = s.player;
			ctx.leave(s);
			ctx.place(s, dest, base, at, prices);
			s.dirty = true;
		});
	} catch (e) {
		ctx.deps.log.error("[GAME] travel failed", e);
		ctx.toast(s, "Couldn't travel. Try again.", false);
	}
}

// ---------- store and land ----------

const atStore = (rt: TRuntime, p: TPlayerState, now: number) => {
	const f = facedTile(p);
	return rt.inst.kind === "world" && terrainAt(rt.inst, f.x, f.y, now) === T.door;
};

/** Buys from or sells to the NPC market while facing a General Store door */
async function trade(ctx: TActionCtx, s: TSession, side: "buy" | "sell", item: string, qty: number | "all") {
	const rt = s.rt;
	const { eco, log } = ctx.deps;
	await ctx.run(rt, async () => {
		if (!ctx.here(s, rt)) return;
		if (!atStore(rt, s.player, ctx.now())) return ctx.toast(s, `Visit the General Store to ${side}.`, false);
		const def = ITEMS[item];
		if (!def?.tradeable) return ctx.toast(s, "The store doesn't trade that.", false);
		let n: number;
		if (qty === "all") {
			const inventory = await eco.inventory(s.userId);
			if (!ctx.here(s, rt)) return;
			n = Math.min(inventory[item] ?? 0, 999);
			if (n === 0) return ctx.toast(s, `You have no ${def.name}.`, false);
		} else n = qty;
		const r = await eco.npcTrade(s.userId, item, side, n).catch((e: unknown) => {
			log.error("[GAME] npc trade failed", e);
			return { ok: false as const, message: FAILED };
		});
		if (!r.ok) return ctx.toast(s, say(r.message), false);
		ctx.toast(s, `${side === "buy" ? "Bought" : "Sold"} ${n} ${def.name} for ${r.total} coins.`, true);
		await ctx.pushWallet(s.userId);
	});
}

/** Unlocks a chunk of the owner's land and sends the new chunk list to everyone there */
async function unlock(ctx: TActionCtx, s: TSession, cx: number, cy: number) {
	const rt = s.rt;
	await ctx.run(rt, async () => {
		if (!ctx.here(s, rt)) return;
		const r = await ctx.deps.store.unlockChunk(rt.inst, s.userId, cx, cy).catch((e: unknown) => {
			ctx.deps.log.error("[GAME] unlock failed", e);
			return { ok: false as const, msg: FAILED };
		});
		if (!r.ok) return ctx.toast(s, say(r.msg), false);
		// The land grew whether or not the owner is still here
		const unlocked = [...rt.inst.unlocked];
		for (const o of rt.sessions) ctx.send(o.ws, { t: "chunks", unlocked });
		ctx.toast(s, `🧱 Land expanded for ${r.price} coins.`, true);
		await ctx.pushWallet(s.userId);
	});
}

// ---------- gems ----------

/** 5 gems on the first hello of each UTC day */
export async function dailyGems(ctx: TActionCtx, s: TSession) {
	const day = utcDay(ctx.now());
	const r = await transact(ctx, [{ userId: s.userId, gems: DAILY_GEMS }], { reason: "daily_gems", idempotencyKey: `daily-gems:${s.userId}:${day}` });
	if (r.ok && !r.duplicate) ctx.toast(s, `Daily reward: +${DAILY_GEMS} 💎`, true);
}

/** The rare gem from mining: a random roll, at most ORE_GEMS_PER_DAY per player per UTC day */
async function oreGem(ctx: TActionCtx, s: TSession) {
	if (ctx.rand() >= ORE_GEM_CHANCE) return;
	const day = utcDay(ctx.now());
	try {
		const k = await ctx.deps.store.claimOreGem(s.userId, day, ORE_GEMS_PER_DAY);
		if (k === null) return;
		// Keyed by the claimed slot, so a retry of the same slot never pays twice
		const t = await transact(ctx, [{ userId: s.userId, gems: 1 }], { reason: "ore_gem", idempotencyKey: `ore-gem:${s.userId}:${day}:${k}` });
		if (t.ok && !t.duplicate) ctx.toast(s, "💎 You found a gem!", true);
	} catch (e) {
		ctx.deps.log.error("[GAME] ore gem failed", e);
	}
}

// ---------- real money ----------

/**
 * DMs a Razorpay link for an item. The webhook grants it and PaymentManager pushes the wallet.
 * Runs outside the instance queue: it changes no game state, and a slow payment API must not hold up the lobby.
 */
export async function buyProduct(ctx: TActionCtx, s: TSession, productId: string) {
	const product = productById(productId);
	// Every product is an item (a pass or cosmetics); gems are earned in game and never sold
	if (!product) return ctx.toast(s, "That isn't for sale.", false);
	const { payments, dm, log } = ctx.deps;
	if (!payments.razorpayEnabled) return ctx.toast(s, "Purchases are not available right now.", false);
	const key = `${s.userId}:${product.id}`;
	const now = ctx.now();
	const sent = ctx.linkSentAt.get(key);
	if (sent !== undefined && now - sent < LINK_COOLDOWN_MS) return ctx.toast(s, "Check your DMs — a link was sent recently.", false);
	// Claimed before the awaits, so a double click sends one link
	ctx.linkSentAt.set(key, now);
	if (ctx.linkSentAt.size > 1000) for (const [k, at] of ctx.linkSentAt) if (now - at >= LINK_COOLDOWN_MS) ctx.linkSentAt.delete(k);
	let url: string;
	try {
		url = await payments.createRazorpayLink(s.userId, product);
	} catch (e) {
		log.error("[GAME] payment link failed", e);
		ctx.linkSentAt.delete(key);
		return ctx.toast(s, "Couldn't create a payment link. Try again later.", false);
	}
	try {
		await dm(s.userId, `${product.emoji} **${product.name}**: pay here within 30 minutes: ${url}\nYour item appears in game as soon as payment completes.`);
	} catch (e) {
		log.warn("[GAME] payment link DM failed", e);
		ctx.linkSentAt.delete(key);
		return ctx.toast(s, "Couldn't DM you. Allow DMs from the bot and try again.", false);
	}
	ctx.toast(s, "Check your DMs to pay.", true);
}
