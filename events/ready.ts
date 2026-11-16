import * as Discord from "discord.js";
import pico from "picocolors";
import EventBuilder from "@Builders/EventBuilder";

const HOUR_MS = 3_600_000;

export default new EventBuilder({
	name: Discord.Events.ClientReady,
	once: true,
	isLocked: false,
	execute: async (client) => {
		// client.loadEssentials();
		client.registerCommands().catch((e) => client.log.error(e));
		// Global jobs run on one process only (shard 0, or the only process when unsharded)
		if (client.shard?.ids.includes(0) ?? true) {
			const msToNextHour = HOUR_MS - (Date.now() % HOUR_MS);
			setTimeout(() => {
				client.economy.marketJob().catch((e) => client.log.error(e));
				setInterval(() => client.economy.marketJob().catch((e) => client.log.error(e)), HOUR_MS);
			}, msToNextHour);
			client.payments.reconcileEntitlements().catch((e) => client.log.error(e));
		}
		client.log.info(`${pico.underline(pico.bold(client.user?.username))} has successfully booted up!`);
	},
});
