import { PROTOCOL_VERSION } from "@game/protocol";
import { setupDiscord } from "./discord";
import { Connection, wsUrl } from "./net";

const app = document.getElementById("app")!;

function showError(message: string): void {
	app.innerHTML = "";
	const box = document.createElement("div");
	box.className = "msg";
	const h = document.createElement("h1");
	h.textContent = "Open this from Discord";
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
	new Connection({
		url: wsUrl(),
		hello: () => ({ t: "hello", v: PROTOCOL_VERSION, token: session.accessToken, instanceId: session.instanceId, guildId: session.guildId }),
		onMessage: () => {},
		onStatus: (s) => {
			app.textContent = s === "ready" ? "Connected" : "Connecting…";
		},
	});
}

main().catch((e: unknown) => showError(e instanceof Error ? e.message : String(e)));
