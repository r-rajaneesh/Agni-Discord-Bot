import { setupDiscord } from "./discord";

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
	const session = await setupDiscord(import.meta.env.VITE_DISCORD_CLIENT_ID as string);
	app.textContent = `Signed in (instance ${session.instanceId})`;
}

main().catch((e: unknown) => showError(e instanceof Error ? e.message : String(e)));
