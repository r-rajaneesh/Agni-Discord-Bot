import * as Discord from "discord.js";
import EventBuilder from "@Builders/EventBuilder";

export default new EventBuilder({
	name: Discord.Events.EntitlementCreate,
	once: false,
	isLocked: false,
	execute: async (client, entitlement: Discord.Entitlement) => {
		try {
			await client.payments.handleEntitlement(entitlement);
		} catch (error) {
			client.log.error("[PAYMENT] entitlementCreate", error);
		}
	},
}).return();
