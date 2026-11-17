import * as Discord from "discord.js";
import CommandBuilder from "@Builders/CommandBuilder";
import { GEM_PRICES, PRODUCTS, productById } from "../../game/data/products";
import type ClientManager from "@Managers/ClientManager";

// Marks the Farm Pass's free refill as used for a UTC day
const passKey = (userId: string) => `passrefill:${userId}:${new Date().toISOString().slice(0, 10)}`;

async function shopView(client: ClientManager, userId: string, status = "") {
	const [wallet, pass] = await Promise.all([client.economy.wallet(userId), client.payments.hasPass(userId)]);
	const free = pass && !(await client.economy.hasEntry(passKey(userId)));
	const container = new Discord.ContainerBuilder()
		.setAccentColor(client.config.colours.blurple)
		.addTextDisplayComponents(
			new Discord.TextDisplayBuilder().setContent(
				[
					"## 🛒 Agni Shop",
					`You have 💎 **${wallet.gems.toLocaleString()}** · Farm Pass: ${pass ? "**active** 👑" : "not active"}`,
					status && `> ${status}`,
					"-# Gems are earned in Agni Valley and are never sold. They cannot be traded, turned into coins, or cashed out.",
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

	container.addSeparatorComponents(new Discord.SeparatorBuilder().setDivider(true));
	container.addTextDisplayComponents(new Discord.TextDisplayBuilder().setContent("### Spend gems"));
	container.addActionRowComponents(
		new Discord.ActionRowBuilder<Discord.ButtonBuilder>().addComponents(
			new Discord.ButtonBuilder()
				.setCustomId("shop:spend:energy")
				.setLabel(free ? "Energy refill (free today with Pass)" : `Energy refill · ${GEM_PRICES.energyRefill} 💎`)
				.setEmoji({ name: "⚡" })
				.setStyle(Discord.ButtonStyle.Success),
		),
	);
	return { components: [container], flags: Discord.MessageFlags.IsComponentsV2 } as const;
}

// Uses the Pass's free daily refill when it is left, else 10 gems, and fills energy in the game
async function refill(client: ClientManager, userId: string): Promise<string> {
	const game = client.gameServer;
	if (!game) return "The game is not running right now. Try again later.";
	// Checked before charging: there is no energy to fill until the player has played
	if (!(await game.hasPlayed(userId))) return "Open the Activity once first.";
	const failed = "Couldn't refill your energy. Try again.";
	const key = passKey(userId);
	if ((await client.payments.hasPass(userId)) && !(await client.economy.hasEntry(key))) {
		// Refill first; the empty ledger entry then marks the free refill as used, so a failure never uses it up
		try {
			if (!(await game.refillEnergy(userId))) return "Open the Activity once first.";
		} catch (e) {
			client.log.error("[SHOP] energy refill failed", e);
			return failed;
		}
		await client.economy.transact([], { reason: "pass_refill", idempotencyKey: key });
		return "⚡ Energy refilled (Farm Pass daily refill).";
	}
	const r = await client.economy.transact([{ userId, gems: -GEM_PRICES.energyRefill }], { reason: "gem_energy_refill" });
	if (!r.ok) return "Not enough gems.";
	let done = false;
	try {
		done = await game.refillEnergy(userId);
	} catch (e) {
		client.log.error("[SHOP] energy refill failed", e);
	}
	if (done) return `⚡ Energy refilled for ${GEM_PRICES.energyRefill} 💎.`;
	await client.economy.transact([{ userId, gems: GEM_PRICES.energyRefill }], { reason: "gem_energy_refill_refund" });
	return failed;
}

export default new CommandBuilder({
	name: "shop",
	description: "Buy the Farm Pass and spend gems",
	permissions: [],
	isLocked: false,
	isOwnerOnly: false,
	type: "slash_command",
	customIdPrefix: "shop",
	builder: new Discord.SlashCommandBuilder().setName("shop").setDescription("Buy the Farm Pass and spend gems"),
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

		if (action === "spend" && arg === "energy") {
			await interaction.deferUpdate();
			return interaction.editReply(await shopView(client, userId, await refill(client, userId)));
		}
		return interaction.deferUpdate();
	},
}).return();
