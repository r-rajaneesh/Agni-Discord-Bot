import * as Discord from "discord.js";
import CommandBuilder from "@Builders/CommandBuilder";
import { ITEMS } from "../../game/data/items";

export default new CommandBuilder({
	name: "wallet",
	description: "Your coins, gems and items",
	permissions: [],
	isLocked: false,
	isOwnerOnly: false,
	type: "slash_command",
	builder: new Discord.SlashCommandBuilder()
		.setName("wallet")
		.setDescription("Your coins, gems and items")
		.addUserOption((o) => o.setName("user").setDescription("Look at someone else's wallet")),
	execute: async ({ client, interaction }) => {
		if (!interaction?.isChatInputCommand()) return;
		const user = interaction.options.getUser("user") ?? interaction.user;
		const [wallet, inventory, pass] = await Promise.all([
			client.economy.wallet(user.id),
			client.economy.inventory(user.id),
			client.payments.hasPass(user.id),
		]);
		const prices = await client.economy.npcPrices(Object.keys(inventory).filter((id) => ITEMS[id]?.tradeable));
		const worth = Object.entries(inventory).reduce((sum, [id, qty]) => sum + (prices[id]?.sell ?? 0) * qty, 0);
		const items = Object.entries(inventory)
			.map(([id, qty]) => `${ITEMS[id]?.emoji ?? "•"} ${ITEMS[id]?.name ?? id} ×${qty}`)
			.join("\n");
		await interaction.reply({
			embeds: [
				client.makeEmbed({
					author: { name: user.displayName, iconURL: user.displayAvatarURL() } as Discord.EmbedAuthorData,
					title: `${pass ? "👑 " : ""}Wallet`,
					fields: [
						{ name: "Coins", value: `🪙 ${wallet.coins.toLocaleString()}`, inline: true },
						{ name: "Gems", value: `💎 ${wallet.gems.toLocaleString()}`, inline: true },
						{ name: "Items (sell value)", value: `🪙 ${worth.toLocaleString()}`, inline: true },
						{ name: "Inventory", value: items || "_Empty_" },
					],
					color: client.config.colours.gold,
				}),
			],
			flags: user.id === interaction.user.id ? Discord.MessageFlags.Ephemeral : undefined,
		});
	},
}).return();
