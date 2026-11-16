import CommandBuilder from "@Builders/CommandBuilder";

// a!economy: money supply and purchase stats for the bot owner
export default new CommandBuilder({
	name: "economy",
	description: "Economy health stats",
	permissions: [],
	isLocked: false,
	isOwnerOnly: true,
	type: "message",
	execute: async ({ client, message }) => {
		const db = client.db;
		const since = new Date(Date.now() - 86_400_000);
		const [supply, ops24h, paid, refunded, openOrders] = await Promise.all([
			client.economy.moneySupply(),
			db.LedgerEntry.countDocuments({ at: { $gte: since } }),
			db.Purchase.countDocuments({ status: "paid" }),
			db.Purchase.countDocuments({ status: "refunded" }),
			db.Order.countDocuments({ status: "open" }),
		]);
		await message?.reply({
			embeds: [
				client.makeEmbed({
					title: "📊 Economy",
					fields: [
						{ name: "Coins in circulation", value: supply.coins.toLocaleString(), inline: true },
						{ name: "Gems outstanding", value: supply.gems.toLocaleString(), inline: true },
						{ name: "Wallets", value: supply.wallets.toLocaleString(), inline: true },
						{ name: "Ledger ops (24h)", value: ops24h.toLocaleString(), inline: true },
						{ name: "Open orders", value: openOrders.toLocaleString(), inline: true },
						{ name: "Purchases paid / refunded", value: `${paid} / ${refunded}`, inline: true },
					],
					color: client.config.colours.gold,
				}),
			],
		});
	},
}).return();
