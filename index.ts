import ClientManager from "@Managers/ClientManager";
import { startServer } from "./server";

const client = new ClientManager();

await client.login(process.env.BOT_TOKEN);

// The webhook server only runs when Razorpay is configured
const server = process.env.RAZORPAY_WEBHOOK_SECRET ? startServer(client) : null;

let stopping = false;
async function shutdown(signal: string) {
	if (stopping) return;
	stopping = true;
	client.log.info(`Received ${signal}, saving game state…`);
	server?.close();
	await client.game.shutdown().catch((e) => client.log.error(e));
	await client.destroy();
	process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
