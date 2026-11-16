import * as Discord from "discord.js";
import CommandBuilder from "@Builders/CommandBuilder";

export default new CommandBuilder({
	name: "farm",
	description: "Agni Valley, a multiplayer farming game",
	permissions: [],
	isLocked: false,
	isOwnerOnly: false,
	type: "slash_command",
	builder: new Discord.SlashCommandBuilder()
		.setName("farm")
		.setDescription("Agni Valley, a multiplayer farming game")
		.setContexts(Discord.InteractionContextType.Guild)
		.setIntegrationTypes(Discord.ApplicationIntegrationType.GuildInstall)
		.addSubcommand((play) => play.setName("play").setDescription("Open your farm (only you can see the controls)")),
	execute: async ({ client, interaction }) => {
		if (!interaction?.isChatInputCommand() || !interaction.guildId) return;
		if (interaction.options.getSubcommand() === "play") await client.game.play(interaction);
	},
}).return();
