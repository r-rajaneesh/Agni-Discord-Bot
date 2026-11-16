import * as Discord from "discord.js";
import CommandBuilder from "@Builders/CommandBuilder";
import { PRODUCTS, productById } from "../../game/data/products";
import type ClientManager from "@Managers/ClientManager";

async function shopView(client: ClientManager, userId: string, status = "") {
	const [wallet, pass] = await Promise.all([client.economy.wallet(userId), client.payments.hasPass(userId)]);
	const container = new Discord.ContainerBuilder()
		.setAccentColor(client.config.colours.blurple)
		.addTextDisplayComponents(
			new Discord.TextDisplayBuilder().setContent(
				[
					"## 💎 Agni Gem Shop",
					`You have 💎 **${wallet.gems.toLocaleString()}** · Farm Pass: ${pass ? "**active** 👑" : "not active"}`,
					status && `> ${status}`,
					"-# Gems are for cosmetics and convenience. They cannot be traded, turned into coins, or cashed out.",
				]
					.filter(Boolean)
					.join("\n"),
			),
		);

	for (const product of PRODUCTS) {
		const price = `₹${(product.priceINR / 100).toFixed(0)}`;
		const row = new Discord.ActionRowBuilder<Discord.ButtonBuilder>();
		// Discord's own checkout, when a SKU is configured for this product
		if (product.discordSku) row.addComponents(new Discord.ButtonBuilder().setStyle(Discord.ButtonStyle.Premium).setSKUId(product.discordSku));
		if (client.payments.razorpayEnabled)
			row.addComponents(
				new Discord.ButtonBuilder()
					.setCustomId(`shop:rzp:${product.id}`)
					.setLabel(`UPI / Card · ${price}`)
					.setEmoji({ name: "💳" })
					.setStyle(Discord.ButtonStyle.Secondary),
			);
		container.addSeparatorComponents(new Discord.SeparatorBuilder().setDivider(true));
		container.addTextDisplayComponents(
			new Discord.TextDisplayBuilder().setContent(`### ${product.emoji} ${product.name} · ${price}\n${product.description}`),
		);
		if (row.components.length) container.addActionRowComponents(row);
	}
	if (!client.payments.razorpayEnabled && !PRODUCTS.some((p) => p.discordSku))
		container.addTextDisplayComponents(new Discord.TextDisplayBuilder().setContent("_Purchases are not enabled on this bot yet._"));

	// TODO(Task 10): the "Spend gems" energy refill returns once the Activity can apply it
	return { components: [container], flags: Discord.MessageFlags.IsComponentsV2 } as const;
}

export default new CommandBuilder({
	name: "shop",
	description: "Buy gems and the Farm Pass",
	permissions: [],
	isLocked: false,
	isOwnerOnly: false,
	type: "slash_command",
	customIdPrefix: "shop",
	builder: new Discord.SlashCommandBuilder().setName("shop").setDescription("Buy gems and the Farm Pass"),
	execute: async ({ client, interaction }) => {
		if (!interaction) return;
		const userId = interaction.user.id;

		if (interaction.isChatInputCommand()) {
			const view = await shopView(client, userId);
			return interaction.reply({ ...view, flags: view.flags | Discord.MessageFlags.Ephemeral });
		}
		if (!interaction.isButton()) return;
		const [, action, arg] = interaction.customId.split(":");

		if (action === "rzp") {
			const product = productById(arg ?? "");
			if (!product || !client.payments.razorpayEnabled) return interaction.deferUpdate();
			await interaction.deferReply({ flags: Discord.MessageFlags.Ephemeral });
			const url = await client.payments.createRazorpayLink(userId, product);
			return interaction.editReply({
				embeds: [
					client.makeEmbed({
						title: `${product.emoji} ${product.name}`,
						description: `Pay ₹${(product.priceINR / 100).toFixed(0)} with UPI, card or netbanking.\nThe link expires in 30 minutes. Your items arrive automatically and you get a DM receipt.`,
						color: client.config.colours.blurple,
					}),
				],
				components: [
					new Discord.ActionRowBuilder<Discord.ButtonBuilder>().addComponents(
						new Discord.ButtonBuilder().setStyle(Discord.ButtonStyle.Link).setURL(url).setLabel("Pay with Razorpay"),
					),
				],
			});
		}

		// Old shop messages may still show the refill button. Nothing can be refilled until the
		// Activity launches (Task 10), so it takes no gems and does not use up the Pass refill.
		if (action === "spend" && arg === "energy") {
			await interaction.deferUpdate();
			return interaction.editReply(await shopView(client, userId, "Energy refills return when Agni Valley launches as an Activity."));
		}
		return interaction.deferUpdate();
	},
}).return();
