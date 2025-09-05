import * as Discord from "discord.js";
import EventBuilder from "@root/builders/EventBuilder";

export default new EventBuilder({
	name: Discord.Events.InteractionCreate,
	once: false,
	isLocked: false,
	execute: async (client, interaction: Discord.CommandInteraction) => {
		client.log.debug("Test 0");
		let SavedUser = await client.db.User.findOne({ id: interaction.user.id });
		let SavedGuild = await client.db.Guild.findOne({
			id: interaction.guildId,
		});
		if (!SavedUser) SavedUser = await client.db.User.create({ id: interaction?.user.id });
		if (!SavedGuild) await client.db.Guild.create({ id: interaction.guildId });
		const locale = client.locale.getlocale("en");

		if (interaction.user.bot) return;
		let command: TCommandBuilder = client.applicationCommands.get(interaction.commandName) as TCommandBuilder;
		if (interaction.isChatInputCommand())
			command = client.applicationCommands
				.filter((cmd) => cmd.type === "slash_command")
				.find((cmd) => cmd.name === interaction.commandName) as TCommandBuilder;
		else if (interaction.isContextMenuCommand())
			command = client.applicationCommands
				.filter((cmd) => cmd.type === "contextmenu")
				.find((cmd) => cmd.name === interaction.commandName) as TCommandBuilder;
		else if (interaction.isButton()) {
			client.log.debug("Test 1");
			command = client.applicationCommands
				.filter((cmd) => cmd.type === "button")
				.find((cmd) => cmd.name === (interaction as Discord.ButtonInteraction).customId) as TCommandBuilder;
			client.log.debug(command);
		}

		if (!command) return;
		try {
			await command.execute({ client, interaction, message: null, args: [], reaction: null, user: null });
		} catch (error) {
			client.log.error(error);
			return await interaction.editReply({
				embeds: [
					client.makeEmbed({
						title: locale.t("events.interactionCreate.executeError.embeds[0].title"),
						description: locale.t("events.interactionCreate.executeError.embeds[0].description"),
						color: client.config.colours.red,
					}),
				],
			});
		} finally {
			client.log.info(`[INTERACTION]`, {
				userID: interaction.user.id,
				commandName: command.name,
				guildID: interaction.guildId,
				channelID: interaction.channelId,
				interactionType: interaction.type,
				timestamp: interaction.createdTimestamp,
			});
		}
	},
});
