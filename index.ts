import { resolve } from "node:path";
import ClientManager from "@Managers/ClientManager";
import ActivityAuth from "@Managers/ActivityAuth";
import GameServer from "@Managers/GameServer";
import InstanceStore from "@Managers/InstanceStore";
import { startServer } from "./server";

const client = new ClientManager();

const clientId = process.env.BOT_ID ?? "";
const clientSecret = process.env.BOT_SECRET ?? "";
const authEnabled = Boolean(clientId && clientSecret);
if (!authEnabled) client.log.warn("BOT_ID or BOT_SECRET missing: /api/token will answer 503");
const auth = new ActivityAuth({ clientId, clientSecret });

const gameServer = new GameServer({
	store: new InstanceStore(client.economy, client.log),
	auth,
	eco: client.economy,
	payments: client.payments,
	dm: async (userId, content) => {
		const user = await client.users.fetch(userId);
		await user.send(content);
	},
	log: client.log,
});
client.gameServer = gameServer;

// Started before login so /health answers while Discord is down
const server = startServer(
	{
		auth,
		authEnabled,
		razorpayWebhook: (raw, sig) => client.payments.handleRazorpayWebhook(raw, sig),
		isReady: () => client.isReady(),
		ws: gameServer,
		staticDir: resolve(import.meta.dir, "activity/dist"),
		log: client.log,
	},
	Number(process.env.PORT) || 3000,
);

await client.login(process.env.BOT_TOKEN);

let stopping = false;
async function shutdown(signal: string) {
	if (stopping) return;
	stopping = true;
	client.log.info(`Received ${signal}, shutting down…`);
	server.stop();
	await gameServer.shutdown();
	await client.destroy();
	process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
