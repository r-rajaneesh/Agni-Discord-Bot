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
		let message = reaction.message;
		if (message?.author?.bot || message.interactionMetadata || message.webhookId) return;
		if (message.partial) message = await message.fetch(true);

		let SavedUser = await client.db.User.findOne({ id: message.author.id });
		let SavedGuild = await client.db.Guild.findOne({ id: message.guildId });

		if (!SavedUser) SavedUser = await client.db.User.create({ id: message.author.id });
		if (!SavedGuild) SavedGuild = await client.db.Guild.create({ id: message.guildId });
		client.messageCommands
			.filter((cmd) => cmd.type === "reaction")
			.forEach(async (command) => {
				try {
					await command.execute({ client, interaction: null, reaction, message: null, args: [], user });
				} catch (error) {
					client.log.error(error);
				} finally {
					client.log.info(`[MESSAGE REACTION]`, {
						userID: message.author.id,
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
