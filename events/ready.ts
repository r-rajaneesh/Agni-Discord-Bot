import * as Discord from "discord.js";
import pico from "picocolors";
import EventBuilder from "@Builders/EventBuilder";

export default new EventBuilder({
	name: Discord.Events.ClientReady,
	once: true,
	isLocked: false,
	execute: async (client) => {
		// client.loadEssentials();
		client.registerCommands();
		client.log.info(`${pico.underline(pico.bold(client.user?.username))} has successfully booted up!`);
	},
});
