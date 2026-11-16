import * as Discord from "discord.js";
import CommandBuilder from "@Builders/CommandBuilder";
import { ITEMS } from "../../game/data/items";
import { TRADE_FEE } from "../../game/market";
import { renderChart } from "../../managers/chart";

const TRADEABLE = Object.values(ITEMS).filter((i) => i.tradeable);
const itemChoices = TRADEABLE.map((i) => ({ name: i.name, value: i.id })).slice(0, 25);

const itemOption = (o: Discord.SlashCommandStringOption) =>
	o.setName("item").setDescription("Item").setRequired(true).addChoices(...itemChoices);
const qtyOption = (o: Discord.SlashCommandIntegerOption) =>
	o.setName("qty").setDescription("Quantity").setRequired(true).setMinValue(1).setMaxValue(999);

const ERRORS: Record<string, string> = {
	insufficient_coins: "🪙 Not enough coins.",
	insufficient_items: "You don't have enough of that item.",
};

export default new CommandBuilder({
	name: "market",
	description: "The live, cross-server market",
	permissions: [],
	isLocked: false,
	isOwnerOnly: false,
	type: "slash_command",
	builder: new Discord.SlashCommandBuilder()
		.setName("market")
		.setDescription("The live, cross-server market")
		.addSubcommand((s) => s.setName("prices").setDescription("Live NPC prices for every item"))
		.addSubcommand((s) =>
			s.setName("buy").setDescription("Buy from the NPC market at the live price").addStringOption(itemOption).addIntegerOption(qtyOption),
		)
		.addSubcommand((s) =>
			s.setName("sell").setDescription("Sell to the NPC market at the live price").addStringOption(itemOption).addIntegerOption(qtyOption),
		)
		.addSubcommand((s) =>
			s
				.setName("order")
				.setDescription(`Place a limit order for other players (${TRADE_FEE * 100}% seller fee)`)
				.addStringOption((o) =>
					o.setName("side").setDescription("Buy or sell").setRequired(true).addChoices({ name: "buy", value: "buy" }, { name: "sell", value: "sell" }),
				)
				.addStringOption(itemOption)
				.addIntegerOption((o) => o.setName("price").setDescription("Coins per unit").setRequired(true).setMinValue(1).setMaxValue(1_000_000))
				.addIntegerOption(qtyOption),
		)
		.addSubcommand((s) => s.setName("orders").setDescription("Your open orders"))
		.addSubcommand((s) =>
			s.setName("cancel").setDescription("Cancel an open order").addStringOption((o) => o.setName("id").setDescription("Order id").setRequired(true)),
		)
		.addSubcommand((s) => s.setName("book").setDescription("Player order book for an item").addStringOption(itemOption))
		.addSubcommand((s) => s.setName("chart").setDescription("48-hour price chart").addStringOption(itemOption)),
	execute: async ({ client, interaction }) => {
		if (!interaction?.isChatInputCommand()) return;
		const sub = interaction.options.getSubcommand();
		const userId = interaction.user.id;
		const eco = client.economy;
		const item = ITEMS[interaction.options.getString("item") ?? ""];
		const qty = interaction.options.getInteger("qty") ?? 0;
		const reply = (title: string, description: string, color = client.config.colours.gold) =>
			interaction.editReply({ embeds: [client.makeEmbed({ title, description, color })] });

		await interaction.deferReply({ flags: sub === "chart" || sub === "book" || sub === "prices" ? undefined : Discord.MessageFlags.Ephemeral });

		switch (sub) {
			case "prices": {
				const prices = await eco.npcPrices(TRADEABLE.map((i) => i.id));
				const line = (id: string) => {
					const p = prices[id]!;
					const base = ITEMS[id]!.basePrice;
					const change = ((p.mid - base) / base) * 100;
					const arrow = change > 0.5 ? "📈" : change < -0.5 ? "📉" : "➖";
					return `${ITEMS[id]!.emoji} **${ITEMS[id]!.name}**: buy 🪙 ${p.buy} · sell 🪙 ${p.sell} ${arrow} ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
				};
				return reply(
					"📊 Live market",
					`${TRADEABLE.map((i) => line(i.id)).join("\n")}\n\n-# % vs. base price. Every trade on every server moves these prices; they drift back each hour.`,
				);
			}
			case "buy":
			case "sell": {
				if (!item) return reply("Market", "Unknown item.", client.config.colours.red);
				const r = await eco.npcTrade(userId, item.id, sub, qty);
				if (!r.ok) return reply("Market", ERRORS[r.error] ?? r.message, client.config.colours.red);
				return reply(
					sub === "buy" ? "✅ Bought" : "✅ Sold",
					`${qty}× ${item.emoji} ${item.name} for 🪙 **${r.total.toLocaleString()}**.\nNew mid price: 🪙 ${r.newMid.toFixed(2)}`,
					client.config.colours.green,
				);
			}
			case "order": {
				if (!item) return reply("Market", "Unknown item.", client.config.colours.red);
				const side = interaction.options.getString("side", true) as "buy" | "sell";
				const price = interaction.options.getInteger("price", true);
				const r = await eco.placeOrder(userId, item.id, side, price, qty);
				if (!r.ok) return reply("Order", ERRORS[r.error] ?? r.message, client.config.colours.red);
				return reply(
					"📝 Order placed",
					`${side.toUpperCase()} ${qty}× ${item.emoji} ${item.name} @ 🪙 ${price}\nFilled now: **${r.filled}** · resting: **${qty - r.filled}**\nOrder id: \`${r.orderId}\``,
					client.config.colours.green,
				);
			}
			case "orders": {
				const orders = await eco.openOrders(userId);
				return reply(
					"📝 Your open orders",
					orders
						.map((o) => `\`${o._id}\` ${o.side.toUpperCase()} ${ITEMS[o.itemId]?.emoji ?? ""} ${o.qty - o.filled}/${o.qty} @ 🪙 ${o.price}`)
						.join("\n") || "_None_",
				);
			}
			case "cancel": {
				const r = await eco.cancelOrder(userId, interaction.options.getString("id", true));
				if (!r.ok) return reply("Cancel", r.message, client.config.colours.red);
				return reply("🗑️ Order cancelled", `Refunded escrow for ${r.refunded} unit(s).`, client.config.colours.green);
			}
			case "book": {
				if (!item) return reply("Market", "Unknown item.", client.config.colours.red);
				const { bids, asks } = await eco.orderBook(item.id);
				const fmt = (rows: typeof bids) => rows.map((o) => `🪙 ${o.price} × ${o.qty - o.filled}`).join("\n") || "_empty_";
				return interaction.editReply({
					embeds: [
						client.makeEmbed({
							title: `📖 ${item.emoji} ${item.name} order book`,
							fields: [
								{ name: "Asks (sell)", value: fmt(asks), inline: true },
								{ name: "Bids (buy)", value: fmt(bids), inline: true },
							],
							color: client.config.colours.gold,
						}),
					],
				});
			}
			case "chart": {
				if (!item) return reply("Market", "Unknown item.", client.config.colours.red);
				const history = await eco.priceHistory(item.id, 48);
				const png = await renderChart(
					`${item.name}, hourly price`,
					history.map((h) => ({ hour: h.hour, close: h.close ?? 0, high: h.high ?? 0, low: h.low ?? 0 })),
				);
				return interaction.editReply({ files: [new Discord.AttachmentBuilder(png, { name: "chart.png" })] });
			}
		}
	},
}).return();
