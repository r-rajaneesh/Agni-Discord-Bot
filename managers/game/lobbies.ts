// Numbered copies of the open world: public lobby #1, more public lobbies as they fill, and one home lobby per guild.
import { createLobby, type TInstance } from "../../game/engine";
import type { TServerMsg } from "../../game/protocol";

export const LOBBY_CAP = 100;
export const PUBLIC_LABEL = "Public";

export default class Lobbies<T extends { inst: TInstance }> {
	private byN = new Map<number, T>();
	/** Guild id → its home lobby number */
	private homes = new Map<string, number>();

	/** `make` wraps a new lobby instance in the caller's runtime */
	constructor(
		private make: (inst: TInstance) => T,
		private epoch: number,
	) {
		this.open(PUBLIC_LABEL, null);
	}

	get(n: number): T | undefined {
		return this.byN.get(n);
	}

	/** Opens a lobby at the lowest free number */
	open(label: string, homeGuildId: string | null): T {
		let n = 1;
		while (this.byN.has(n)) n++;
		const rt = this.make(createLobby(n, label, homeGuildId, this.epoch));
		this.byN.set(n, rt);
		if (homeGuildId) this.homes.set(homeGuildId, n);
		return rt;
	}

	/** The guild's home lobby while it has room, else the fullest public lobby with room, else a new one */
	pick(home: { id: string; name: string } | null): T {
		if (home) {
			const n = this.homes.get(home.id);
			const rt = (n !== undefined && this.byN.get(n)) || this.open(`Home · ${home.name}`, home.id);
			if (rt.inst.players.size < LOBBY_CAP) return rt;
		}
		let best: T | undefined;
		for (const rt of this.byN.values()) {
			const size = rt.inst.players.size;
			if (rt.inst.lobby!.homeGuildId !== null || size >= LOBBY_CAP) continue;
			if (!best || size > best.inst.players.size) best = rt;
		}
		return best ?? this.open(PUBLIC_LABEL, null);
	}

	/** Lobby #1 never closes */
	close(n: number) {
		const rt = this.byN.get(n);
		if (!rt || n === 1) return;
		this.byN.delete(n);
		const home = rt.inst.lobby!.homeGuildId;
		if (home && this.homes.get(home) === n) this.homes.delete(home);
	}

	list(current: number | null): Extract<TServerMsg, { t: "lobbyList" }> {
		return {
			t: "lobbyList",
			current,
			lobbies: [...this.byN.values()]
				.map(({ inst }) => ({ n: inst.lobby!.n, label: inst.lobby!.label, players: inst.players.size, home: inst.lobby!.homeGuildId !== null }))
				.sort((a, b) => a.n - b.n),
		};
	}
}
