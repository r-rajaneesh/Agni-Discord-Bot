import Phaser from "phaser";
import { PROTOCOL_VERSION } from "@game/protocol";
import { setupDiscord } from "./discord";
import { Connection, wsUrl } from "./net";
import { World } from "./scenes/World";
import { ClientState } from "./state";

const app = document.getElementById("app")!;

function showError(message: string, title = "Open this from Discord"): void {
	app.className = "";
	app.innerHTML = "";
	const box = document.createElement("div");
	box.className = "msg";
	const h = document.createElement("h1");
	h.textContent = title;
	const p = document.createElement("p");
	p.textContent = message;
	box.append(h, p);
	app.append(box);
}

async function main(): Promise<void> {
	const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;
	if (!clientId) throw new Error("VITE_DISCORD_CLIENT_ID is not set");
	const session = await setupDiscord(clientId);
	app.textContent = "Connecting…";

	const state = new ClientState();
	let game: Phaser.Game | null = null;
	let world: World | null = null;
	let kicked = false;
	// Shown over the game while the socket is reconnecting
	const banner = document.createElement("div");
	banner.className = "banner";
	banner.textContent = "Reconnecting…";

	// The scene starts on the first welcome; later welcomes (lobby switch, travel) go through handle()
	const start = () => {
		app.textContent = "";
		app.className = "game";
		banner.hidden = true;
		app.append(banner);
		world = new World(state);
		game = new Phaser.Game({
			type: Phaser.AUTO,
			parent: app,
			backgroundColor: "#14181f",
			pixelArt: true,
			roundPixels: true,
			scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
			scene: world,
		});
	};

	new Connection({
		url: wsUrl(),
		hello: () => ({ t: "hello", v: PROTOCOL_VERSION, token: session.accessToken, instanceId: session.instanceId, guildId: session.guildId }),
		onMessage: (m) => {
			if (m.t === "kicked") {
				kicked = true;
				game?.destroy(true);
				game = null;
				showError(m.reason, "Disconnected");
				return;
			}
			const hints = state.apply(m);
			if (m.t === "welcome" && !game) start();
			else world?.handle(hints);
		},
		onStatus: (s) => {
			if (kicked) return;
			if (game) banner.hidden = s === "ready";
			else app.textContent = s === "ready" ? "Connected" : "Connecting…";
		},
	});
}

main().catch((e: unknown) => showError(e instanceof Error ? e.message : String(e)));
