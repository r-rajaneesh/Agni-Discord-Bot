import Phaser from "phaser";
import { PROTOCOL_VERSION } from "@game/protocol";
import { setupDiscord } from "./discord";
import { GameClient } from "./client";
import { Input } from "./input";
import { Connection, wsUrl } from "./net";
import { Predictor } from "./predict";
import { Boot } from "./scenes/Boot";
import { World } from "./scenes/World";
import { ClientState } from "./state";
import { GameUI } from "./ui";

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
	const predictor = new Predictor(state, () => Date.now());
	let conn: Connection | null = null;
	let game: Phaser.Game | null = null;
	let world: World | null = null;
	let ui: GameUI | null = null;
	let input: Input | null = null;
	let raf = 0;
	// Shown over the game while the socket is reconnecting
	const banner = document.createElement("div");
	banner.className = "banner";
	banner.textContent = "Reconnecting…";

	// Input and prediction run every animation frame, beside Phaser's own loop
	let last = performance.now();
	const frame = (t: number) => {
		const dt = t - last;
		last = t;
		const d = input?.dir() ?? { dx: 0, dy: 0 };
		client.frame(dt, d.dx, d.dy);
		ui?.update(Date.now());
		raf = requestAnimationFrame(frame);
	};

	const client = new GameClient({
		state,
		predictor,
		send: (m) => conn?.send(m),
		// The scene starts on the first welcome; later welcomes (lobby switch, travel) go through handle()
		start: () => {
			app.textContent = "";
			app.className = "game";
			banner.hidden = true;
			app.append(banner);
			world = new World(state, () => predictor.drawn());
			game = new Phaser.Game({
				type: Phaser.AUTO,
				parent: app,
				backgroundColor: "#14181f",
				// Smooth vector art: linear filtering, with mipmaps so the 128 px atlas frames shrink cleanly to 48 px
				pixelArt: false,
				antialias: true,
				roundPixels: true,
				render: { mipmapFilter: "LINEAR_MIPMAP_LINEAR" },
				scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
				scene: [new Boot(), world],
			});
			const gameUi = new GameUI(app, state, (m) => client.send(m));
			ui = gameUi;
			input = new Input(
				{
					use: () => gameUi.use(),
					inventory: () => gameUi.toggleInventory(),
					slot: (i) => gameUi.slot(i),
					close: () => gameUi.close(),
					lobbies: () => gameUi.toggleLobbies(),
					chat: () => gameUi.focusChat(),
					emotes: () => gameUi.toggleEmotes(),
				},
				gameUi.root,
			);
			last = performance.now();
			raf = requestAnimationFrame(frame);
		},
		handle: (hints, m) => {
			world?.handle(hints);
			if (m.t === "chat" && m.channel === "local") world?.say(m.from.userId, m.text);
			if (m.t === "emote") world?.emote(m.userId, m.id);
			ui?.message(m);
		},
		// Final: GameClient ignores everything after this, so nothing can restart the game over this screen
		kicked: (reason) => {
			cancelAnimationFrame(raf);
			input?.destroy();
			input = null;
			game?.destroy(true);
			game = null;
			world = null;
			ui = null;
			showError(reason, "Disconnected");
		},
		status: (s) => {
			if (game) banner.hidden = s === "ready";
			else app.textContent = s === "ready" ? "Connected" : "Connecting…";
		},
	});

	conn = new Connection({
		url: wsUrl(),
		hello: () => ({ t: "hello", v: PROTOCOL_VERSION, token: session.accessToken, instanceId: session.instanceId, guildId: session.guildId }),
		onMessage: (m) => client.onMessage(m),
		onStatus: (s) => client.onStatus(s),
	});
}

main().catch((e: unknown) => showError(e instanceof Error ? e.message : String(e)));
