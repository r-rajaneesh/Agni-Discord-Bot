// Wire protocol shared by the Bun server and the browser client. No imports.

export const PROTOCOL_VERSION = 1;
export const MAX_MSG_BYTES = 2048;

export type TDir = "u" | "d" | "l" | "r";

export type TClientMsg =
	| { t: "hello"; v: number; token: string; instanceId: string; guildId: string | null } // first message only
	| { t: "input"; seq: number; dx: -1 | 0 | 1; dy: -1 | 0 | 1 } // held direction
	| { t: "chat"; text: string } // raw text incl. "/p " or "/g " prefix
	| { t: "use"; seq: number }
	| { t: "equip"; item: string }
	| { t: "sleep" }
	| { t: "travel"; to: "world" | "land" }
	| { t: "buy"; item: string; qty: number }
	| { t: "sell"; item: string; qty: number | "all" }
	| { t: "unlock"; cx: number; cy: number }
	| { t: "buyProduct"; productId: string }
	| { t: "lobbies" }
	| { t: "switchLobby"; lobby: number }
	| { t: "emote"; id: string }
	| { t: "buyCosmetic"; itemId: string; via: "gems" | "razorpay" };

export type TTileView = { tilled?: boolean; cropId?: string; plantedDay?: number; wateredDays: number[]; clearedDay?: number; regrowAt?: number };

export interface TPlayerView {
	userId: string;
	name: string;
	x: number;
	y: number;
	facing: TDir;
	equipped: string;
	colour: string;
	premium: boolean;
}

export interface TSnapshot {
	instance: {
		id: string;
		kind: "land" | "world";
		seed: number;
		ownerId: string | null;
		epoch: number;
		unlocked: string[];
		lobby: { n: number; label: string } | null; // null on private land
	};
	tiles: [string, TTileView][];
	players: TPlayerView[];
	you: TPlayerView;
	prices: Record<string, { buy: number; sell: number }>;
}

export type TServerMsg =
	| { t: "welcome"; userId: string; snapshot: TSnapshot }
	| { t: "you"; x: number; y: number; facing: TDir; ack: number } // ack = last applied input seq
	| { t: "player"; p: TPlayerView } // joined or moved
	| { t: "left"; userId: string }
	| { t: "tiles"; tiles: [string, TTileView | null][] }
	| { t: "chunks"; unlocked: string[] }
	| { t: "ents"; ents: [id: number, kind: string, x: number, y: number, facing: TDir][] } // ids absent have left AOI
	| { t: "wallet"; coins: number; gems: number; inventory: Record<string, number>; energy: number }
	| { t: "toast"; msg: string; ok: boolean }
	| { t: "menu"; menu: "shop" }
	| { t: "lobbyList"; current: number | null; lobbies: { n: number; label: string; players: number; home: boolean }[] }
	| { t: "emote"; userId: string; id: string }
	| { t: "owned"; items: string[] }
	| { t: "chat"; channel: "local" | "private" | "global"; from: { userId: string; name: string }; text: string; at: number }
	| { t: "kicked"; reason: string };

const MAX_STR = 64;

// Bounded non-empty string
const str = (v: unknown, max = MAX_STR): string | null => (typeof v === "string" && v.length >= 1 && v.length <= max ? v : null);
const int = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);

export function parseClientMessage(raw: string | Uint8Array): TClientMsg | null {
	if (raw.length > MAX_MSG_BYTES) return null;
	let m: Record<string, unknown>;
	try {
		const j: unknown = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
		if (typeof j !== "object" || j === null || Array.isArray(j)) return null;
		m = j as Record<string, unknown>;
	} catch {
		return null;
	}
	switch (m.t) {
		case "hello": {
			const v = int(m.v, 0, 1_000_000);
			const token = str(m.token, 1024);
			const instanceId = str(m.instanceId);
			const guildId = m.guildId === null ? null : str(m.guildId);
			if (v === null || !token || !instanceId || (guildId === null && m.guildId !== null)) return null;
			return { t: "hello", v, token, instanceId, guildId };
		}
		case "input": {
			const seq = int(m.seq, 0, Number.MAX_SAFE_INTEGER);
			const dx = int(m.dx, -1, 1);
			const dy = int(m.dy, -1, 1);
			if (seq === null || dx === null || dy === null) return null;
			return { t: "input", seq, dx: dx as -1 | 0 | 1, dy: dy as -1 | 0 | 1 };
		}
		case "chat": {
			if (typeof m.text !== "string") return null;
			const text = m.text.trim();
			return text.length >= 1 && text.length <= 200 ? { t: "chat", text } : null;
		}
		case "use": {
			const seq = int(m.seq, 0, Number.MAX_SAFE_INTEGER);
			return seq === null ? null : { t: "use", seq };
		}
		case "equip": {
			const item = str(m.item);
			return item ? { t: "equip", item } : null;
		}
		case "sleep":
			return { t: "sleep" };
		case "travel":
			return m.to === "world" || m.to === "land" ? { t: "travel", to: m.to } : null;
		case "buy": {
			const item = str(m.item);
			const qty = int(m.qty, 1, 999);
			return item && qty !== null ? { t: "buy", item, qty } : null;
		}
		case "sell": {
			const item = str(m.item);
			const qty = m.qty === "all" ? "all" : int(m.qty, 1, 999);
			return item && qty !== null ? { t: "sell", item, qty } : null;
		}
		case "unlock": {
			const cx = int(m.cx, -10_000, 10_000);
			const cy = int(m.cy, -10_000, 10_000);
			return cx === null || cy === null ? null : { t: "unlock", cx, cy };
		}
		case "buyProduct": {
			const productId = str(m.productId);
			return productId ? { t: "buyProduct", productId } : null;
		}
		case "lobbies":
			return { t: "lobbies" };
		case "switchLobby": {
			const lobby = int(m.lobby, 1, 10_000);
			return lobby === null ? null : { t: "switchLobby", lobby };
		}
		case "emote": {
			const id = str(m.id);
			return id ? { t: "emote", id } : null;
		}
		case "buyCosmetic": {
			const itemId = str(m.itemId);
			if (!itemId || (m.via !== "gems" && m.via !== "razorpay")) return null;
			return { t: "buyCosmetic", itemId, via: m.via };
		}
		default:
			return null;
	}
}
