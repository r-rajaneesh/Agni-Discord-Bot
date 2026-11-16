import * as Discord from "discord.js";
import type ClientManager from "./ClientManager";
import {
	MAX_ENERGY,
	clock,
	currentEnergy,
	joinWorld,
	move,
	sleep,
	tileKey,
	use,
	type TActionResult,
	type TDir,
	type TPlayerState,
	type TTileState,
	type TWorldState,
} from "../game/engine";
import { ITEMS, STARTER_COINS, STARTER_KIT, TOOL_IDS } from "../game/data/items";
import { MAP_H, MAP_W, PLOTS } from "../game/map";
import { VIEW_H, VIEW_W } from "./RenderManager";

export type TInput =
	| { kind: "move"; dir: TDir }
	| { kind: "use" }
	| { kind: "equip"; item: string }
	| { kind: "view"; view: TView }
	| { kind: "sleep" }
	| { kind: "buy"; item: string; qty: number }
	| { kind: "sell"; item: string; qty: number | "all" };

export type TView = "game" | "shop" | "inventory" | "players" | "help";

interface TSession {
	guildId: string;
	userId: string;
	/** Latest interaction; its token can edit the player's ephemeral message for 15 minutes */
	interaction: Discord.ChatInputCommandInteraction | Discord.MessageComponentInteraction;
	tokenAt: number;
	view: TView;
	status: string;
	rendering: boolean;
	queue: TInput[];
	actionTimes: number[];
	lastPushAt: number;
	pushTimer?: ReturnType<typeof setTimeout>;
	idleTimer?: ReturnType<typeof setTimeout>;
}

/** Inputs buffered while a frame renders; extra presses are dropped */
const MAX_QUEUE = 5;
const MAX_ACTIONS_PER_SEC = 4;
const PUSH_INTERVAL_MS = 2000;
/** Interaction tokens last 15 minutes; stop pushing a little before that */
const TOKEN_TTL_MS = 14 * 60 * 1000;
const FLUSH_MS = 5000;
const UPDATE_DEADLINE_MS = 2500;
const EXPIRED_STATUS = "⏱️ This game closed after 2 minutes without input. Run `/farm play` to keep playing.";
/** A viewport with no presses for this long is closed; the player runs /farm play again */
export const IDLE_TIMEOUT_MS = 2 * 60 * 1000;

const camera = (p: { x: number; y: number }) => ({
	x: Math.min(Math.max(p.x - Math.floor(VIEW_W / 2), 0), MAP_W - VIEW_W),
	y: Math.min(Math.max(p.y - Math.floor(VIEW_H / 2), 0), MAP_H - VIEW_H),
});
const inView = (viewer: TPlayerState, x: number, y: number) => {
	const c = camera(viewer);
	return x >= c.x && x < c.x + VIEW_W && y >= c.y && y < c.y + VIEW_H;
};

export default class GameManager {
	private client: ClientManager;
	private worlds = new Map<string, TWorldState>();
	private loading = new Map<string, Promise<TWorldState>>();
	private locks = new Map<string, Promise<unknown>>();
	private sessions = new Map<string, TSession>();
	private dirtyPlayers = new Set<string>();
	private flushTimer: ReturnType<typeof setInterval>;

	constructor(client: ClientManager) {
		this.client = client;
		this.flushTimer = setInterval(() => this.flush().catch((e) => this.client.log.error(e)), FLUSH_MS);
	}

	// ---------- world state ----------

	private async world(guildId: string) {
		const loaded = this.worlds.get(guildId);
		if (loaded) return loaded;
		let pending = this.loading.get(guildId);
		if (!pending) {
			pending = this.loadWorld(guildId).finally(() => this.loading.delete(guildId));
			this.loading.set(guildId, pending);
		}
		return pending;
	}

	private async loadWorld(guildId: string): Promise<TWorldState> {
		const db = this.client.db;
		const doc = await db.GameWorld.findOneAndUpdate(
			{ guildId },
			{ $setOnInsert: { guildId, epoch: Date.now(), plotOwners: PLOTS.map(() => null) } },
			{ upsert: true, new: true },
		).lean();
		const [tiles, players] = await Promise.all([db.GameTile.find({ guildId }).lean(), db.GamePlayer.find({ guildId }).lean()]);
		const world: TWorldState = {
			guildId,
			epoch: doc!.epoch,
			plotOwners: PLOTS.map((_, i) => (doc!.plotOwners[i] as string | null) ?? null),
			tiles: new Map(
				tiles.map((t) => [
					tileKey(t.x, t.y),
					{
						tilled: t.tilled ?? undefined,
						cropId: t.cropId ?? undefined,
						plantedDay: t.plantedDay ?? undefined,
						wateredDays: t.wateredDays ?? [],
						clearedDay: t.clearedDay ?? undefined,
					} as TTileState,
				]),
			),
			players: new Map(
				players.map((p) => [
					p.userId,
					{
						userId: p.userId,
						name: p.name ?? "Farmer",
						x: p.x ?? 0,
						y: p.y ?? 0,
						facing: (p.facing as TDir) ?? "d",
						energy: p.energy ?? MAX_ENERGY,
						lastEnergyAt: p.lastEnergyAt ?? Date.now(),
						equipped: p.equipped ?? "hoe",
						plotId: p.plotId ?? null,
						colour: p.colour ?? "#e74c3c",
					},
				]),
			),
		};
		this.worlds.set(guildId, world);
		this.client.log.info(`[GAME] Loaded world for guild ${guildId}: ${tiles.length} tiles, ${players.length} players`);
		return world;
	}

	/** Serializes all mutations of one guild's world */
	private async withWorld<T>(guildId: string, fn: (world: TWorldState) => Promise<T>): Promise<T> {
		const world = await this.world(guildId);
		const prev = this.locks.get(guildId) ?? Promise.resolve();
		const run = prev.then(() => fn(world));
		const tail = run.catch(() => {});
		this.locks.set(guildId, tail);
		tail.then(() => {
			if (this.locks.get(guildId) === tail) this.locks.delete(guildId);
		});
		return run;
	}

	private async saveTiles(guildId: string, world: TWorldState, keys: string[]) {
		await Promise.all(
			keys.map((key) => {
				const [x, y] = key.split(",").map(Number) as [number, number];
				const t = world.tiles.get(key);
				if (!t) return this.client.db.GameTile.deleteOne({ guildId, x, y });
				const set: Record<string, unknown> = { wateredDays: t.wateredDays };
				const unset: Record<string, 1> = {};
				for (const f of ["tilled", "cropId", "plantedDay", "clearedDay"] as const)
					if (t[f] === undefined) unset[f] = 1;
					else set[f] = t[f];
				return this.client.db.GameTile.updateOne({ guildId, x, y }, { $set: set, $unset: unset }, { upsert: true });
			}),
		);
	}

	/** Write-behind for positions/energy; economic changes are written immediately elsewhere */
	public async flush() {
		if (!this.dirtyPlayers.size) return;
		const keys = [...this.dirtyPlayers];
		this.dirtyPlayers.clear();
		const ops = keys.flatMap((k) => {
			const [guildId, userId] = k.split(":") as [string, string];
			const p = this.worlds.get(guildId)?.players.get(userId);
			return p ? [{ updateOne: { filter: { guildId, userId }, update: { $set: { ...p } }, upsert: true } }] : [];
		});
		if (ops.length) await this.client.db.GamePlayer.bulkWrite(ops);
	}

	/** Gem sink / Farm Pass perk: full energy in every world the player is in */
	public async refillEnergy(userId: string) {
		const now = Date.now();
		for (const world of this.worlds.values()) {
			const p = world.players.get(userId);
			if (!p) continue;
			p.energy = MAX_ENERGY;
			p.lastEnergyAt = now;
			this.dirtyPlayers.add(this.sessionKey(world.guildId, userId));
		}
		await this.client.db.GamePlayer.updateMany({ userId }, { $set: { energy: MAX_ENERGY, lastEnergyAt: now } });
	}

	public async shutdown() {
		for (const s of this.sessions.values()) {
			clearTimeout(s.idleTimer);
			clearTimeout(s.pushTimer);
		}
		clearInterval(this.flushTimer);
		await this.flush();
	}

	// ---------- sessions & input ----------

	private sessionKey = (guildId: string, userId: string) => `${guildId}:${userId}`;

	/** `/farm play`: join (or rejoin) the guild world and open the private viewport */
	public async play(interaction: Discord.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild() && !interaction.guildId) return;
		await interaction.deferReply({ flags: Discord.MessageFlags.Ephemeral });
		const guildId = interaction.guildId as string;
		const userId = interaction.user.id;
		const name = (interaction.member as Discord.GuildMember | null)?.displayName ?? interaction.user.displayName;
		let isNew = false;
		const premium = await this.client.payments.hasPass(userId);
		await this.withWorld(guildId, async (world) => {
			isNew = !world.players.has(userId);
			const hadPlot = world.players.get(userId)?.plotId ?? null;
			const p = joinWorld(world, userId, name, Date.now());
			p.premium = premium;
			if (p.plotId !== hadPlot)
				await this.client.db.GameWorld.updateOne({ guildId }, { $set: { plotOwners: world.plotOwners } });
			this.dirtyPlayers.add(this.sessionKey(guildId, userId));
		});
		// One starter kit per user, across all guilds
		await this.client.economy.transact([{ userId, coins: STARTER_COINS, items: STARTER_KIT }], {
			reason: "starter_kit",
			idempotencyKey: `starter:${userId}`,
		});
		const p = this.worlds.get(guildId)!.players.get(userId)!;
		const session: TSession = {
			guildId,
			userId,
			interaction,
			tokenAt: Date.now(),
			view: "game",
			status: isNew
				? p.plotId !== null
					? "Welcome to Agni Valley! Your plot has a gold outline. Equip the hoe and press Use facing farmland."
					: "Welcome to Agni Valley! All farm plots are taken, but you can chop, mine and trade."
				: "Welcome back!",
			rendering: false,
			queue: [],
			actionTimes: [],
			lastPushAt: 0,
		};
		const old = this.sessions.get(this.sessionKey(guildId, userId));
		this.sessions.set(this.sessionKey(guildId, userId), session);
		// Only one live viewport per player: close the previous window
		if (old) void this.expire(old, "This window was replaced by a newer `/farm play`.");
		this.touch(session);
		await this.pushView(session);
		this.notifyNearby(guildId, userId, [{ x: p.x, y: p.y }]);
	}

	/** Button/select press on a viewport */
	public async input(interaction: Discord.MessageComponentInteraction, input: TInput) {
		const guildId = interaction.guildId;
		if (!guildId) return;
		const key = this.sessionKey(guildId, interaction.user.id);
		const found = this.sessions.get(key);
		if (!found) {
			// Viewport timed out, was replaced, or the bot restarted: show it as closed
			const world = await this.world(guildId);
			if (!world.players.has(interaction.user.id))
				return interaction.reply({ content: "Use `/farm play` to join.", flags: Discord.MessageFlags.Ephemeral });
			const closed: TSession = {
				guildId,
				userId: interaction.user.id,
				interaction,
				tokenAt: Date.now(),
				view: "game",
				status: EXPIRED_STATUS,
				rendering: false,
				queue: [],
				actionTimes: [],
				lastPushAt: 0,
			};
			return interaction.update((await this.buildView(closed, true)) as Discord.InteractionUpdateOptions);
		}
		const session = found;
		this.touch(session);
		const now = Date.now();
		session.actionTimes = session.actionTimes.filter((t) => now - t < 1000);
		if (session.actionTimes.length >= MAX_ACTIONS_PER_SEC) return interaction.deferUpdate();
		session.actionTimes.push(now);
		session.interaction = interaction;
		session.tokenAt = now;
		if (session.rendering) {
			// A frame is in flight: acknowledge now, the next batch picks this press up
			if (session.queue.length < MAX_QUEUE) session.queue.push(input);
			return interaction.deferUpdate();
		}
		session.queue.push(input);
		await this.pump(session, interaction);
	}

	/** Restarts the idle countdown; called on every press */
	private touch(session: TSession) {
		if (session.idleTimer) clearTimeout(session.idleTimer);
		session.idleTimer = setTimeout(() => void this.expire(session, EXPIRED_STATUS), IDLE_TIMEOUT_MS);
	}

	/** Closes a viewport: drops the session and redraws the message with every control disabled */
	private async expire(session: TSession, status: string) {
		if (session.rendering) {
			// Let the in-flight frame land first, then close
			session.idleTimer = setTimeout(() => void this.expire(session, status), 500);
			return;
		}
		clearTimeout(session.idleTimer);
		clearTimeout(session.pushTimer);
		session.pushTimer = undefined;
		const key = this.sessionKey(session.guildId, session.userId);
		if (this.sessions.get(key) === session) this.sessions.delete(key);
		session.status = status;
		session.view = "game";
		try {
			await session.interaction.editReply(await this.buildView(session, true));
		} catch (error) {
			// Token expired or message dismissed; nothing left to update
			this.client.log.debug("[GAME] could not close viewport", error);
		}
	}

	/**
	 * Applies every queued input, then renders once. Presses that arrive mid-render join the next batch.
	 * The first frame answers `respondTo` with interaction.update(), one Discord round trip instead of defer + edit.
	 */
	private async pump(session: TSession, respondTo?: Discord.MessageComponentInteraction) {
		session.rendering = true;
		// Discord needs an answer within 3s; defer if the frame is somehow slower than that
		let deferred: Promise<unknown> | null = null;
		const first = respondTo;
		const timer = first ? setTimeout(() => (deferred = first.deferUpdate()), UPDATE_DEADLINE_MS) : undefined;
		try {
			while (session.queue.length) {
				const batch = session.queue.splice(0);
				const moved: { x: number; y: number }[] = [];
				for (const input of batch) {
					const before = this.worlds.get(session.guildId)?.players.get(session.userId);
					const from = before ? { x: before.x, y: before.y } : null;
					await this.apply(session, input);
					const after = this.worlds.get(session.guildId)?.players.get(session.userId);
					if (from && after && (after.x !== from.x || after.y !== from.y)) moved.push(from, { x: after.x, y: after.y });
				}
				if (respondTo) {
					const payload = await this.buildView(session);
					session.lastPushAt = Date.now();
					clearTimeout(timer);
					if (deferred) {
						await deferred;
						await respondTo.editReply(payload);
					} else await respondTo.update(payload as Discord.InteractionUpdateOptions);
					respondTo = undefined;
				} else await this.pushView(session);
				if (moved.length) this.notifyNearby(session.guildId, session.userId, moved);
			}
		} catch (error) {
			this.client.log.error(error);
			// Never leave the press unanswered ("This interaction failed")
			if (respondTo && !respondTo.deferred && !respondTo.replied) await respondTo.deferUpdate().catch(() => {});
		} finally {
			clearTimeout(timer);
			session.rendering = false;
		}
	}

	private economyMessage(r: { ok: false; message: string; error: string }) {
		if (r.error === "insufficient_coins") return "🪙 Not enough coins.";
		if (r.error === "insufficient_items") return r.message.startsWith("Not enough") ? r.message : "Not enough items.";
		return r.message;
	}

	private async apply(session: TSession, input: TInput) {
		const { guildId, userId } = session;
		const eco = this.client.economy;
		switch (input.kind) {
			case "move":
				return this.withWorld(guildId, async (world) => {
					const r = move(world, userId, input.dir, Date.now());
					session.status = r.msg;
					this.dirtyPlayers.add(this.sessionKey(guildId, userId));
				});
			case "use": {
				const inventory = await eco.inventory(userId);
				return this.withWorld(guildId, async (world) => {
					const r: TActionResult = use(world, userId, Date.now(), inventory);
					session.status = r.msg;
					if (!r.ok) return;
					// Debit first (fails cleanly), mutate + persist, then credit: a crash never duplicates items
					if (r.take) {
						const neg = Object.fromEntries(Object.entries(r.take).map(([k, v]) => [k, -v]));
						const paid = await eco.transact([{ userId, items: neg }], { reason: "farm_use" });
						if (!paid.ok) return void (session.status = this.economyMessage(paid));
					}
					r.apply?.();
					if (r.changedTiles?.length) await this.saveTiles(guildId, world, r.changedTiles);
					if (r.give) await eco.transact([{ userId, items: r.give }], { reason: "farm_harvest" });
					if (r.menu === "shop") session.view = "shop";
					this.dirtyPlayers.add(this.sessionKey(guildId, userId));
				});
			}
			case "sleep":
				return this.withWorld(guildId, async (world) => {
					const r = sleep(world, userId, Date.now());
					session.status = r.msg;
					r.apply?.();
					session.view = "game";
					this.dirtyPlayers.add(this.sessionKey(guildId, userId));
				});
			case "equip": {
				const inventory = await eco.inventory(userId);
				const item = ITEMS[input.item];
				const allowed = (TOOL_IDS as readonly string[]).includes(input.item) || (item?.category === "seed" && (inventory[input.item] ?? 0) > 0);
				if (!item || !allowed) return void (session.status = "You can't hold that.");
				const p = (await this.world(guildId)).players.get(userId);
				if (p) p.equipped = input.item;
				session.status = `Holding ${item.emoji} ${item.name}.`;
				this.dirtyPlayers.add(this.sessionKey(guildId, userId));
				return;
			}
			case "view":
				session.view = input.view;
				session.status = "";
				return;
			case "buy": {
				const r = await eco.npcTrade(userId, input.item, "buy", input.qty);
				session.status = r.ok
					? `Bought ${input.qty}× ${ITEMS[input.item]?.name} for 🪙 ${r.total.toLocaleString()}.`
					: this.economyMessage(r);
				return;
			}
			case "sell": {
				const qty = input.qty === "all" ? ((await eco.inventory(userId))[input.item] ?? 0) : input.qty;
				if (qty <= 0) return void (session.status = "You have none to sell.");
				const r = await eco.npcTrade(userId, input.item, "sell", qty);
				session.status = r.ok
					? `Sold ${qty}× ${ITEMS[input.item]?.name} for 🪙 ${r.total.toLocaleString()}.`
					: this.economyMessage(r);
				return;
			}
		}
	}

	/** Re-renders other players' viewports that can see the given tiles, throttled per viewer */
	private notifyNearby(guildId: string, moverId: string, tiles: { x: number; y: number }[]) {
		const world = this.worlds.get(guildId);
		if (!world) return;
		const now = Date.now();
		for (const s of this.sessions.values()) {
			if (s.guildId !== guildId || s.userId === moverId || s.view !== "game") continue;
			if (now - s.tokenAt > TOKEN_TTL_MS || s.rendering || s.pushTimer) continue;
			const viewer = world.players.get(s.userId);
			if (!viewer || !tiles.some((t) => inView(viewer, t.x, t.y))) continue;
			const wait = Math.max(0, s.lastPushAt + PUSH_INTERVAL_MS - now);
			s.pushTimer = setTimeout(() => {
				s.pushTimer = undefined;
				if (s.rendering || Date.now() - s.tokenAt > TOKEN_TTL_MS) return;
				this.pushView(s).catch((e) => this.client.log.error(e));
			}, wait);
		}
	}

	// ---------- views ----------

	private async pushView(session: TSession) {
		session.lastPushAt = Date.now();
		const payload = await this.buildView(session);
		await session.interaction.editReply(payload);
	}

	public onlinePlayers(guildId: string) {
		const now = Date.now();
		return [...this.sessions.values()].filter((s) => s.guildId === guildId && now - s.tokenAt < TOKEN_TTL_MS);
	}

	/** `closed`: draw the game view with every control disabled (timed-out or replaced viewport) */
	private async buildView(session: TSession, closed = false): Promise<Discord.InteractionEditReplyOptions> {
		const { guildId, userId } = session;
		const world = await this.world(guildId);
		const p = world.players.get(userId)!;
		const now = Date.now();
		const [wallet, inventory] = await Promise.all([this.client.economy.wallet(userId), this.client.economy.inventory(userId)]);
		const { day, label } = clock(world.epoch, now);
		const held = ITEMS[p.equipped];
		const header = `**Day ${day} · ${label}** · ⚡ ${currentEnergy(p, now)}/${MAX_ENERGY} · 🪙 ${wallet.coins.toLocaleString()} · 💎 ${wallet.gems.toLocaleString()}`;
		const status = session.status ? `\n> ${session.status}` : "";
		const container = new Discord.ContainerBuilder().setAccentColor(this.client.config.colours.darkGreen);
		const back = new Discord.ActionRowBuilder<Discord.ButtonBuilder>().addComponents(
			new Discord.ButtonBuilder().setCustomId("farm:view:game").setLabel("Back to farm").setEmoji({ name: "⬅️" }).setStyle(Discord.ButtonStyle.Secondary),
		);
		const files: Discord.AttachmentBuilder[] = [];

		if (session.view === "game") {
			const png = await this.client.render.renderFrame(world, userId, now);
			files.push(new Discord.AttachmentBuilder(png, { name: "frame.png" }));
			const btn = (id: string, emoji: string, style = Discord.ButtonStyle.Secondary, label?: string) => {
				const b = new Discord.ButtonBuilder().setCustomId(id).setEmoji({ name: emoji }).setStyle(style).setDisabled(closed);
				return label ? b.setLabel(label) : b;
			};
			const equipOptions = [
				...TOOL_IDS.map((id) => ({ id, label: ITEMS[id]!.name, emoji: ITEMS[id]!.emoji })),
				...Object.entries(inventory)
					.filter(([id]) => ITEMS[id]?.category === "seed")
					.map(([id, qty]) => ({ id, label: `${ITEMS[id]!.name} ×${qty}`, emoji: ITEMS[id]!.emoji })),
			].slice(0, 25);
			container
				.addMediaGalleryComponents(
					new Discord.MediaGalleryBuilder().addItems(new Discord.MediaGalleryItemBuilder().setURL("attachment://frame.png")),
				)
				.addTextDisplayComponents(
					new Discord.TextDisplayBuilder().setContent(`${header}\nHolding: ${held?.emoji ?? ""} ${held?.name ?? "nothing"}${status}`),
				)
				.addActionRowComponents(
					new Discord.ActionRowBuilder<Discord.ButtonBuilder>().addComponents(
						btn("farm:mv:l", "◀️"),
						btn("farm:mv:u", "🔼"),
						btn("farm:mv:d", "🔽"),
						btn("farm:mv:r", "▶️"),
						btn("farm:use", "✋", Discord.ButtonStyle.Primary, "Use"),
					),
				)
				.addActionRowComponents(
					new Discord.ActionRowBuilder<Discord.StringSelectMenuBuilder>().addComponents(
						new Discord.StringSelectMenuBuilder()
							.setCustomId("farm:eq")
							.setPlaceholder("Equip…")
							.setDisabled(closed)
							.addOptions(
								equipOptions.map((o) => ({ label: o.label, value: o.id, emoji: { name: o.emoji }, default: o.id === p.equipped })),
							),
					),
				)
				.addActionRowComponents(
					new Discord.ActionRowBuilder<Discord.StringSelectMenuBuilder>().addComponents(
						new Discord.StringSelectMenuBuilder()
							.setCustomId("farm:menu")
							.setPlaceholder("Menu…")
							.setDisabled(closed)
							.addOptions(
								{ label: "Inventory", value: "inventory", emoji: { name: "🎒" } },
								{ label: "General Store", value: "shop", emoji: { name: "🏪" } },
								{ label: "Sleep (after 18:00)", value: "sleep", emoji: { name: "🛏️" } },
								{ label: "Who's online", value: "players", emoji: { name: "👥" } },
								{ label: "How to play", value: "help", emoji: { name: "❓" } },
							),
					),
				);
		} else if (session.view === "shop") {
			const seeds = Object.values(ITEMS).filter((i) => i.category === "seed");
			const sellable = Object.entries(inventory).filter(([id]) => ITEMS[id]?.tradeable && ITEMS[id]?.category !== "seed");
			const prices = await this.client.economy.npcPrices([...seeds.map((s) => s.id), ...sellable.map(([id]) => id)]);
			const seedLines = seeds.map((s) => `${s.emoji} **${s.name}**: 🪙 ${prices[s.id]!.buy}`).join("\n");
			const sellLines = sellable.length
				? sellable.map(([id, qty]) => `${ITEMS[id]!.emoji} **${ITEMS[id]!.name}** ×${qty}: 🪙 ${prices[id]!.sell} each`).join("\n")
				: "_Nothing to sell yet. Harvest crops, chop trees or mine rocks._";
			container.addTextDisplayComponents(
				new Discord.TextDisplayBuilder().setContent(
					`## 🏪 General Store\n${header}${status}\n### Seeds\n${seedLines}\n### Your goods\n${sellLines}\n-# Prices move with what every player buys and sells, across all servers.`,
				),
			);
			container.addActionRowComponents(
				new Discord.ActionRowBuilder<Discord.StringSelectMenuBuilder>().addComponents(
					new Discord.StringSelectMenuBuilder()
						.setCustomId("farm:buy")
						.setPlaceholder("Buy seeds…")
						.addOptions(
							seeds.flatMap((s) =>
								[1, 5, 10].map((q) => ({ label: `${q}× ${s.name}`, value: `${s.id}:${q}`, emoji: { name: s.emoji } })),
							),
						),
				),
			);
			if (sellable.length)
				container.addActionRowComponents(
					new Discord.ActionRowBuilder<Discord.StringSelectMenuBuilder>().addComponents(
						new Discord.StringSelectMenuBuilder()
							.setCustomId("farm:sell")
							.setPlaceholder("Sell…")
							.addOptions(
								sellable
									.flatMap(([id, qty]) => [
										{ label: `Sell all ${qty}× ${ITEMS[id]!.name}`, value: `${id}:all`, emoji: { name: ITEMS[id]!.emoji } },
										{ label: `Sell 1× ${ITEMS[id]!.name}`, value: `${id}:1`, emoji: { name: ITEMS[id]!.emoji } },
									])
									.slice(0, 25),
							),
					),
				);
			container.addActionRowComponents(back);
		} else if (session.view === "inventory") {
			const lines = Object.entries(inventory)
				.map(([id, qty]) => `${ITEMS[id]?.emoji ?? "•"} **${ITEMS[id]?.name ?? id}** ×${qty}`)
				.join("\n");
			container
				.addTextDisplayComponents(new Discord.TextDisplayBuilder().setContent(`## 🎒 Inventory\n${header}${status}\n${lines || "_Empty_"}`))
				.addActionRowComponents(back);
		} else if (session.view === "players") {
			const online = this.onlinePlayers(guildId)
				.map((s) => world.players.get(s.userId))
				.filter((x): x is TPlayerState => !!x)
				.map((pl) => `• **${pl.name}**${pl.plotId !== null ? ` (plot ${pl.plotId + 1})` : ""} at ${pl.x},${pl.y}`)
				.join("\n");
			container
				.addTextDisplayComponents(new Discord.TextDisplayBuilder().setContent(`## 👥 Farmers online\n${online || "_Just you_"}`))
				.addActionRowComponents(back);
		} else {
			container
				.addTextDisplayComponents(
					new Discord.TextDisplayBuilder().setContent(
						[
							"## ❓ How to play",
							"Move with the arrows. **Use** acts on the tile you face (white square).",
							"• **Hoe** on farmland inside your gold plot → till it",
							"• **Seeds** on tilled soil → plant",
							"• **Watering can** on planted soil once per day. Each watered day grows the crop.",
							"• **Use** with anything on a ripe crop → harvest",
							"• **Axe** on trees → wood. **Pickaxe** on rocks → stone and ores (try the quarry east of the river).",
							"• Walk into the store door, or open the Menu, to buy seeds and sell goods.",
							"One in-game day lasts 20 real minutes. Sleep after 18:00 to restore energy.",
							"Other farmers appear on your screen and update live while you are playing.",
						].join("\n"),
					),
				)
				.addActionRowComponents(back);
		}
		return { components: [container], files, attachments: [], flags: Discord.MessageFlags.IsComponentsV2 } as Discord.InteractionEditReplyOptions;
	}
}
