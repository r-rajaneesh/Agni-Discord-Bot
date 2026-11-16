import * as Discord from "discord.js";
import EventBuilder from "@Builders/EventBuilder";

// Discord deletes an entitlement on refund or chargeback
export default new EventBuilder({
	name: Discord.Events.EntitlementDelete,
	once: false,
	isLocked: false,
	execute: async (client, entitlement: Discord.Entitlement) => {
		try {
			await client.payments.handleEntitlement(entitlement, true);
		} catch (error) {
			client.log.error("[PAYMENT] entitlementDelete", error);
		}
	},
}).return();
