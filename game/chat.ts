// Chat rules shared by server and client: what a typed line means, and who hears local chat.
import type { TInstance } from "./engine";

export const CHAT_RADIUS = 8;
export const CHAT_MAX = 200;

export type TChatChannel = "local" | "private" | "global";
export type TChatCommand =
	| { kind: "say"; channel: TChatChannel; text: string }
	| { kind: "mute" | "unmute"; name: string }
	| { kind: "error"; msg: string };

const UNKNOWN = "Unknown command. Use /g, /p, /e, /mute or /unmute.";
const CHANNELS: Record<string, TChatChannel> = { "/g": "global", "/p": "private" };

/** Control characters (and bidi overrides) removed; tabs and newlines become spaces */
export function sanitizeChat(raw: string): string {
	return raw
		.replace(/[\t\r\n]+/g, " ")
		.replace(/[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/g, "")
		.trim();
}

/** Reads one typed line: plain text is local, "/g" global, "/p" private, "/mute" and "/unmute" take a name */
export function parseChat(raw: string): TChatCommand {
	const line = sanitizeChat(raw);
	if (!line) return { kind: "error", msg: "Type a message." };
	if (!line.startsWith("/")) return { kind: "say", channel: "local", text: line.slice(0, CHAT_MAX) };
	// The prefix ends at the first space or at the end of the line, so "/party" is not "/p arty"
	const space = line.search(/\s/);
	const cmd = (space === -1 ? line : line.slice(0, space)).toLowerCase();
	const rest = space === -1 ? "" : line.slice(space).trim();
	const channel = CHANNELS[cmd];
	if (channel) return rest ? { kind: "say", channel, text: rest.slice(0, CHAT_MAX) } : { kind: "error", msg: `Type a message after ${cmd}.` };
	if (cmd === "/mute" || cmd === "/unmute") return rest ? { kind: cmd === "/mute" ? "mute" : "unmute", name: rest } : { kind: "error", msg: `Type a name after ${cmd}.` };
	// Emotes arrive with Task 18
	if (cmd === "/e") return { kind: "error", msg: rest ? "Emotes are not available yet." : "Type an emote after /e." };
	return { kind: "error", msg: UNKNOWN };
}

/** Ids of the players in the instance within CHAT_RADIUS tiles of the sender, sender included */
export function localAudience(inst: TInstance, fromId: string): string[] {
	const from = inst.players.get(fromId);
	if (!from) return [];
	const out: string[] = [];
	for (const p of inst.players.values()) if (Math.hypot(p.x - from.x, p.y - from.y) <= CHAT_RADIUS) out.push(p.userId);
	return out;
}
