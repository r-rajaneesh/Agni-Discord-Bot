// Chat over the websocket: local (nearby), private (everyone on the land or in the lobby) and global, with mutes and rate limits.
import { localAudience, parseChat } from "../../game/chat";
import type { TServerMsg } from "../../game/protocol";
import type { TGameServerDeps, TSession, TSocket } from "../GameServer";

/** One message per player per this long, and one global message per player per GLOBAL_MS */
export const CHAT_GAP_MS = 1000;
export const GLOBAL_MS = 5000;

/** What the handler needs from the GameServer */
export interface TChatCtx {
	deps: TGameServerDeps;
	now(): number;
	send(ws: TSocket, msg: TServerMsg): void;
	toast(s: TSession, msg: string, ok: boolean): void;
	/** Every connected session */
	sessions(): Iterable<TSession>;
}

/** Handles one typed line from a player */
export async function chat(ctx: TChatCtx, s: TSession, text: string): Promise<void> {
	const now = ctx.now();
	if (now - s.lastChatAt < CHAT_GAP_MS) return ctx.toast(s, "You're sending messages too fast.", false);
	s.lastChatAt = now;
	const cmd = parseChat(text);
	switch (cmd.kind) {
		case "error":
			return ctx.toast(s, cmd.msg, false);
		case "mute":
		case "unmute":
			return mute(ctx, s, cmd.kind, cmd.name);
		case "say": {
			if (cmd.channel === "global") {
				if (s.globalMutedUntil > now) return ctx.toast(s, "You are muted from global chat.", false);
				if (now - s.lastGlobalAt < GLOBAL_MS) return ctx.toast(s, "Wait a few seconds before sending another global message.", false);
				s.lastGlobalAt = now;
			}
			const audience = hearers(ctx, s, cmd.channel);
			const msg: TServerMsg = { t: "chat", channel: cmd.channel, from: { userId: s.userId, name: s.player.name }, text: cmd.text, at: now };
			// Muted senders are hidden from the muter only
			for (const o of audience) if (o === s || !o.mutedIds.has(s.userId)) ctx.send(o.ws, msg);
			if (cmd.channel !== "local") {
				await ctx.deps.store.logChat({ channel: cmd.channel, fromId: s.userId, instanceId: s.rt.inst.id, text: cmd.text, at: now }).catch((e: unknown) => ctx.deps.log.error("[GAME] chat log failed", e));
			}
		}
	}
}

function hearers(ctx: TChatCtx, s: TSession, channel: "local" | "private" | "global"): Iterable<TSession> {
	if (channel === "global") return ctx.sessions();
	if (channel === "private") return s.rt.sessions;
	const near = new Set(localAudience(s.rt.inst, s.userId));
	return [...s.rt.sessions].filter((o) => near.has(o.userId));
}

// /mute and /unmute name an online player by display name, case-insensitive
async function mute(ctx: TChatCtx, s: TSession, kind: "mute" | "unmute", name: string) {
	const want = name.toLowerCase();
	const found = [...ctx.sessions()].filter((o) => o.player.name.toLowerCase() === want);
	if (found.length === 0) return ctx.toast(s, `No player named ${name} is online.`, false);
	const target = found[0] as TSession;
	if (found.length > 1) return ctx.toast(s, `More than one player is named ${name}.`, false);
	if (target === s) return ctx.toast(s, "You can't mute yourself.", false);
	if (kind === "mute") s.mutedIds.add(target.userId);
	else s.mutedIds.delete(target.userId);
	ctx.toast(s, kind === "mute" ? `Muted ${target.player.name}.` : `Unmuted ${target.player.name}.`, true);
	await ctx.deps.store.setMutedIds(s.userId, [...s.mutedIds]).catch((e: unknown) => ctx.deps.log.error("[GAME] saving mutes failed", e));
}
