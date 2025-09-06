import * as Discord from "discord.js";
import CommandBuilder from "../../builders/CommandBuilder";

export default new CommandBuilder({
	name: "Bookmark to DM",
	description: "Bookmark a message to your DM",
	isLocked: false,
	permissions: [],
	isOwnerOnly: false,
	type: "contextmenu",
	builder: new Discord.ContextMenuCommandBuilder()
		.setName("Bookmark to DM")
		.setType(Discord.ApplicationCommandType.Message)
		.setContexts(Discord.InteractionContextType.Guild)
		.setIntegrationTypes(Discord.ApplicationIntegrationType.GuildInstall)
		.setDefaultMemberPermissions(
			Discord.PermissionFlagsBits.SendMessages | Discord.PermissionFlagsBits.ReadMessageHistory,
		),
	execute: async ({ client, interaction }) => {
		if (!interaction || !interaction.isContextMenuCommand()) return;
		if (!interaction.isMessageContextMenuCommand()) return;
		await interaction.deferReply({ flags: Discord.MessageFlags.Ephemeral, withResponse: true });
		const locale = client.locale.getlocale("en");
		let DBBookmarkedMessage = await client.db.Bookmark.findOne({ messageID: interaction.targetMessage.id });
		if (DBBookmarkedMessage) {
			let DMBookmarkedMessage = DBBookmarkedMessage.DM.find((value, idx) => value.userID == interaction.user.id);
			if (DMBookmarkedMessage) {
				return await interaction.editReply({
					embeds: [
						client.makeEmbed({
							title: locale.t("commands.bookmark.embeds[0].title"),
							description: locale.t("commands.bookmark.embeds[0].description", {
								message_link: Discord.messageLink(DMBookmarkedMessage.channelID, DMBookmarkedMessage.messageID),
							}),
							color: client.config.colours.lightYellow,
						}),
					],
				});
			}

			if (!(await interaction.user.createDM()).isSendable())
				return await interaction.editReply({
					embeds: [
						client.makeEmbed({
							title: locale.t("commands.bookmark.embeds[1].title"),
							description: locale.t("commands.bookmark.embeds[1].description"),
							color: client.config.colours.red,
						}),
					],
				});
		}
		DBBookmarkedMessage ??= await client.db.Bookmark.create({
			messageID: interaction.targetMessage.id,
			channelID: interaction.targetMessage.channel.id,
			guildID: interaction.targetMessage.guild?.id,
			authorID: interaction.targetMessage.author.id,
		});
		const attachingEmbeds: Discord.EmbedBuilder[] = [];
		attachingEmbeds.push(
			client.makeEmbed({
				title: locale.t("commands.bookmark.embeds[2].title"),
				description: locale.t("commands.bookmark.embeds[2].description"),
				fields: [
					{
						name: locale.t("commands.bookmark.embeds[2].fields[0].name"),
						value: locale.t("commands.bookmark.embeds[2].fields[0].value", {
							attachment_types:
								interaction.targetMessage.attachments.size > 0
									? interaction.targetMessage.attachments.map((atv) => atv.contentType).join(", ")
									: "0",
						}),
					},
					{
						name: locale.t("commands.bookmark.embeds[2].fields[1].name"),
						value: locale.t("commands.bookmark.embeds[2].fields[1].value", {
							embeds_length: interaction.targetMessage.embeds.length ?? "0",
						}),
					},
					{
						name: locale.t("commands.bookmark.embeds[2].fields[2].name"),
						value: locale.t("commands.bookmark.embeds[2].fields[2].value", {
							original_message_link: interaction.targetMessage.url,
						}),
					},
				],
				footer: {
					text: locale.t("commands.bookmark.embeds[2].footer.text", {
						original_message_id: interaction.targetMessage.id,
					}),
				},
			}),
		);
		if (interaction.targetMessage.content)
			attachingEmbeds.push(
				client.makeEmbed({
					title: locale.t("commands.bookmark.embeds[3].title"),
					description: `${
						interaction.targetMessage?.content?.length > 2400
							? `${interaction.targetMessage?.content.slice(0, 4080)}***...***`
							: interaction.targetMessage?.content
					}`,
					color: client.config.colours.background,
				}),
			);
		interaction.targetMessage.embeds.slice(0, 11).forEach((embed) => {
			const Embed = client.makeEmbed({
				...embed.toJSON(),
				url: interaction.targetMessage.url,
				color: client.config.colours.blurple,
			});
			embed?.image?.url ? Embed.setImage(embed.image.url) : undefined;
			attachingEmbeds.push(Embed);
		});
		// interaction.targetMessage.attachments.at(0);
		interaction.targetMessage.attachments.toJSON().at(0)?.contentType == "";
		interaction.targetMessage.attachments
			.toJSON()
			.filter((attachment) => attachment.contentType?.startsWith("image"))
			.slice(0, 4)
			.forEach((attachment) =>
				attachingEmbeds.push(
					client.makeEmbed({
						image: { url: attachment.url },
						url: interaction.targetMessage.url,
						color: client.config.colours.blurple,
					}),
				),
			);

		const DeleteButton = new Discord.ButtonBuilder()
			.setId(1)
			.setCustomId("bookmark-delete")
			.setDisabled(false)
			.setLabel("Delete Bookmark")
			.setEmoji({ name: "🗑️" })
			.setStyle(Discord.ButtonStyle.Danger);
		const BookmarkedMessage: Discord.Message = (await (
			await interaction.user.createDM(true)
		)
			.send({
				embeds: attachingEmbeds,
				files: [],
				components: [new Discord.ActionRowBuilder<Discord.ButtonBuilder>().addComponents(DeleteButton)],
			})
			.catch(client.log.error)) as Discord.Message;
		DBBookmarkedMessage.DM.push({
			channelID: BookmarkedMessage.channelId,
			messageID: BookmarkedMessage.id,
			userID: interaction.user.id,
		});
		await DBBookmarkedMessage.save();
		await interaction.editReply({
			embeds: [
				client.makeEmbed({
					title: locale.t("commands.bookmark.embeds[4].title"),
					description: locale.t("commands.bookmark.embeds[4].description", { message_link: BookmarkedMessage.url }),
					footer: { text: locale.t("commands.bookmark.embeds[4].footer.text") },
					color: client.config.colours.green,
				}),
			],
		});
	},
}).return();
