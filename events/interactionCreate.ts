import * as Discord from "discord.js";
import EventBuilder from "@root/builders/EventBuilder";

// Component and modal customIds follow `<route>:<action>:<arg...>`; the route picks the handler.
function findComponentHandler(client: any, customId: string): TCommandBuilder | undefined {
	const route = customId.split(":")[0];
	return client.applicationCommands.find(
		(cmd: TCommandBuilder) => (cmd.customIdPrefix && cmd.customIdPrefix === route) || cmd.name === customId,
	);
}

export default new EventBuilder({
	name: Discord.Events.InteractionCreate,
	once: false,
	isLocked: false,
	execute: async (client, interaction: Discord.Interaction) => {
		if (interaction.user.bot) return;
		const SavedUser = await client.db.getUser(interaction.user.id);
		await client.db.getGuild(interaction.guildId);
		const locale = client.locale.getlocale((SavedUser?.locale as Tlanguages) ?? "en");

		let command: TCommandBuilder | undefined;
		if (interaction.isChatInputCommand())
			command = client.applicationCommands.find(
				(cmd) => cmd.type === "slash_command" && cmd.name === interaction.commandName,
			);
		else if (interaction.isContextMenuCommand())
			command = client.applicationCommands.find(
				(cmd) => cmd.type === "contextmenu" && cmd.name === interaction.commandName,
			);
		else if (interaction.isMessageComponent() || interaction.isModalSubmit())
			command = findComponentHandler(client, interaction.customId);

		if (!command) return;
		try {
			await command.execute({ client, interaction, message: null, args: [], reaction: null, user: null });
		} catch (error) {
			client.log.error(error);
			if (!interaction.isRepliable()) return;
			const payload = {
				embeds: [
					client.makeEmbed({
						title: locale.t("events.interactionCreate.executeError.embeds[0].title"),
						description: locale.t("events.interactionCreate.executeError.embeds[0].description"),
						color: client.config.colours.red,
					}),
				],
			};
			if (interaction.deferred || interaction.replied)
				await interaction.followUp({ ...payload, flags: Discord.MessageFlags.Ephemeral }).catch(client.log.error);
			else await interaction.reply({ ...payload, flags: Discord.MessageFlags.Ephemeral }).catch(client.log.error);
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
