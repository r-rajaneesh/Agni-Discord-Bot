import { resolve } from "node:path";
import ClientManager from "@Managers/ClientManager";
import ActivityAuth from "@Managers/ActivityAuth";
import { startServer } from "./server";

const client = new ClientManager();

await client.login(process.env.BOT_TOKEN);

const clientId = process.env.BOT_ID ?? "";
const clientSecret = process.env.BOT_SECRET ?? "";
const authEnabled = Boolean(clientId && clientSecret);
if (!authEnabled) client.log.warn("BOT_ID or BOT_SECRET missing: /api/token will answer 503");

const server = startServer(
	{
		auth: new ActivityAuth({ clientId, clientSecret }),
		authEnabled,
		razorpayWebhook: (raw, sig) => client.payments.handleRazorpayWebhook(raw, sig),
		isReady: () => client.isReady(),
		// Placeholder until the game server exists
		ws: {
			open: (ws) => ws.close(1013, "game server starting"),
			message: () => {},
			close: () => {},
		},
		staticDir: resolve(import.meta.dir, "activity/dist"),
		log: client.log,
	},
	Number(process.env.PORT ?? 3000),
);

let stopping = false;
async function shutdown(signal: string) {
	if (stopping) return;
	stopping = true;
	client.log.info(`Received ${signal}, shutting down…`);
	server.stop();
	await client.destroy();
	process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
