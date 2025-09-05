import ClientManager from "@Managers/ClientManager";

const client = new ClientManager();

await client.login(process.env.BOT_TOKEN);
