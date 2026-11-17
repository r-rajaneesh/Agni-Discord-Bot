import * as Discord from "discord.js";
import CommandBuilder from "@Builders/CommandBuilder";

// /gmute <user> <minutes>: keeps a player out of global chat in the Activity. 0 minutes lifts it.
export default new CommandBuilder({
	name: "gmute",
	description: "Mute a player from Activity global chat (bot owner only)",
	permissions: [],
	isLocked: false,
	isOwnerOnly: true,
	type: "slash_command",
	builder: new Discord.SlashCommandBuilder()
		.setName("gmute")
		.setDescription("Mute a player from Activity global chat (bot owner only)")
		.setDefaultMemberPermissions(0)
		.addUserOption((o) => o.setName("user").setDescription("Player to mute").setRequired(true))
		.addIntegerOption((o) => o.setName("minutes").setDescription("How long; 0 lifts the mute").setMinValue(0).setMaxValue(525_600).setRequired(true)),
	execute: async ({ client, interaction }) => {
		if (!interaction?.isChatInputCommand()) return;
		const reply = (content: string) => interaction.reply({ content, flags: Discord.MessageFlags.Ephemeral });
		// Slash commands are not filtered by isOwnerOnly, so check here
		if (interaction.user.id !== client.config.owner.userid) return void (await reply("Only the bot owner can use this."));
		const user = interaction.options.getUser("user", true);
		const minutes = interaction.options.getInteger("minutes", true);
		if (!(await client.gameServer.hasPlayed(user.id))) return void (await reply(`${user.displayName} has not played yet.`));
		await client.gameServer.globalMute(user.id, minutes === 0 ? 0 : Date.now() + minutes * 60_000);
		await reply(minutes === 0 ? `Lifted ${user.displayName}'s global mute.` : `${user.displayName} is muted from global chat for ${minutes} min.`);
	},
}).return();
