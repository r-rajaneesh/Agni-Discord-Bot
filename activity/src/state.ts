// Client mirror of what the server has told us. A pure reducer: the scene reacts to the hints apply() returns.
import { createLand, createLobby, type TInstance } from "@game/engine";
import type { TPlayerView, TServerMsg, TSnapshot } from "@game/protocol";

export interface TWallet {
	coins: number;
	gems: number;
	inventory: Record<string, number>;
	energy: number;
}

export interface THints {
	/** Tile keys whose state changed */
	redrawTiles?: string[];
	/** Terrain or chunk locks changed; redraw every chunk */
	redrawChunks?: boolean;
	/** The instance changed (a welcome); drop everything drawn for the old one */
	reset?: boolean;
	/** Other players that joined, moved or left */
	players?: string[];
}

// The server builds the same instance, so terrainAt gives the same answer on both sides
function buildInstance(s: TSnapshot["instance"]): TInstance {
	const inst = s.kind === "world" ? createLobby(s.lobby?.n ?? 0, s.lobby?.label ?? "", null, s.epoch) : createLand(s.id, s.ownerId ?? "", s.seed, s.epoch);
	inst.id = s.id;
	inst.seed = s.seed;
	inst.unlocked = new Set(s.unlocked);
	return inst;
}

export class ClientState {
	userId: string | null = null;
	instance: TInstance | null = null;
	you: TPlayerView | null = null;
	/** Last input seq the server applied */
	ack = 0;
	/** Other players, by userId */
	players = new Map<string, TPlayerView>();
	wallet: TWallet = { coins: 0, gems: 0, inventory: {}, energy: 0 };
	prices: Record<string, { buy: number; sell: number }> = {};

	apply(m: TServerMsg): THints {
		switch (m.t) {
			case "welcome": {
				// Sent again on every lobby switch or travel, so it always replaces everything
				const s = m.snapshot;
				this.userId = m.userId;
				this.instance = buildInstance(s.instance);
				for (const [k, t] of s.tiles) this.instance.tiles.set(k, t);
				this.you = { ...s.you };
				this.ack = 0;
				this.players = new Map(s.players.filter((p) => p.userId !== m.userId).map((p) => [p.userId, { ...p }]));
				this.prices = s.prices;
				return { reset: true, redrawChunks: true, players: [...this.players.keys()] };
			}
			case "you": {
				if (!this.you) return {};
				// Task 14 adds prediction; for now the server position is drawn as is
				this.you = { ...this.you, x: m.x, y: m.y, facing: m.facing };
				this.ack = m.ack;
				return {};
			}
			case "player": {
				if (m.p.userId === this.userId) {
					if (this.you) this.you = { ...this.you, ...m.p, x: this.you.x, y: this.you.y, facing: this.you.facing };
					return {};
				}
				this.players.set(m.p.userId, { ...m.p });
				return { players: [m.p.userId] };
			}
			case "left":
				this.players.delete(m.userId);
				return { players: [m.userId] };
			case "tiles": {
				if (!this.instance) return {};
				const keys: string[] = [];
				for (const [k, t] of m.tiles) {
					if (t === null) this.instance.tiles.delete(k);
					else this.instance.tiles.set(k, t);
					keys.push(k);
				}
				return { redrawTiles: keys };
			}
			case "chunks":
				if (!this.instance) return {};
				this.instance.unlocked = new Set(m.unlocked);
				return { redrawChunks: true };
			case "wallet":
				this.wallet = { coins: m.coins, gems: m.gems, inventory: m.inventory, energy: m.energy };
				return {};
			default:
				return {};
		}
	}
}
