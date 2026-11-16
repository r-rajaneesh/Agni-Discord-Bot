import EventBuilder from "@root/builders/EventBuilder";
import * as Discord from "discord.js";
export default new EventBuilder({
	name: Discord.Events.MessageReactionAdd,
	once: false,
	isLocked: false,
	execute: async (
		client,
		reaction: Discord.MessageReaction,
		user: Discord.User,
		details: Discord.MessageReactionEventDetails,
	) => {
		// Ignore reactions from bots; the message author may be Agni itself (🗑️ delete relies on that)
		if (user.bot) return;
		let message = reaction.message;
		if (message.partial) message = await message.fetch(true);
		if (message.webhookId) return;

		await client.db.getUser(user.id);
		await client.db.getGuild(message.guildId);
		client.messageCommands
			.filter((cmd) => cmd.type === "reaction")
			.forEach(async (command) => {
				try {
					await command.execute({ client, interaction: null, reaction, message: null, args: [], user });
				} catch (error) {
					client.log.error(error);
				} finally {
					client.log.info(`[MESSAGE REACTION]`, {
						userID: user.id,
						commandName: command.name,
						guildID: message.guildId,
						channelID: message.channelId,
						messageID: message.id,
						reactionID: reaction.emoji.name,
						messageType: Discord.MessageType[message.type],
						timestamp: message.createdTimestamp,
					});
				}
			});
	},
}).return();
