import * as Discord from "discord.js";
import EventBuilder from "@Builders/EventBuilder";

// Fires on subscription renewals and cancellations
export default new EventBuilder({
	name: Discord.Events.EntitlementUpdate,
	once: false,
	isLocked: false,
	execute: async (client, _old: Discord.Entitlement | null, entitlement: Discord.Entitlement) => {
		try {
			await client.payments.handleEntitlement(entitlement);
		} catch (error) {
			client.log.error("[PAYMENT] entitlementUpdate", error);
		}
	},
}).return();
