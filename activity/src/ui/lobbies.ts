// The lobby switcher: asks the server for the list, then lets you jump to another lobby
import type { TClientMsg, TServerMsg } from "@game/protocol";
import { button, el, Panel } from "./dom";

export class LobbyPanel extends Panel {
	constructor(private send: (m: TClientMsg) => void) {
		super("Lobbies", "panel-lobbies");
	}

	/** Shows a placeholder and asks the server; render() fills in the reply */
	request(): void {
		this.body.replaceChildren(el("p", "muted", "Loading…"));
		this.send({ t: "lobbies" });
	}

	render(m: Extract<TServerMsg, { t: "lobbyList" }>): void {
		const list = el("div", "list");
		for (const l of m.lobbies) {
			const here = l.n === m.current;
			const b = button("", () => {
				if (!here) this.send({ t: "switchLobby", lobby: l.n });
			}, here ? "lobby lobby-here" : "lobby");
			if (here) b.setAttribute("aria-current", "true");
			b.append(
				el("span", "lobby-n", `#${l.n}`),
				el("span", "lobby-label", `${l.home ? "🏠 " : ""}${l.label}`),
				el("span", "lobby-count", here ? `${l.players} · you're here` : `${l.players} ${l.players === 1 ? "player" : "players"}`),
			);
			list.append(b);
		}
		if (!m.lobbies.length) list.append(el("p", "muted", "No lobbies open."));
		this.body.replaceChildren(list);
	}
}
