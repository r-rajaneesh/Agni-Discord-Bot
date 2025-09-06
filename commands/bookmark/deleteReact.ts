import CommandBuilder from "@root/builders/CommandBuilder";
import type ClientManager from "@root/managers/ClientManager";
import * as Discord from "discord.js";

export default new CommandBuilder({
	name: "delete-message-reaction",
	description: "Delete messages sent by the application when reacting to 🗑️",
	isLocked: false,
	isOwnerOnly: false,
	permissions: [],
	type: "reaction",
	execute: async ({ client, interaction, reaction, args, user }) => {
		let message = await reaction?.message;
		if (message?.author?.id !== client.user?.id) return;
		message = (await message?.partial)
			? ((await message?.fetch(true)) as Discord.Message)
			: (message as Discord.Message);
		user = user?.partial ? await user.fetch(true) : user;
		if (reaction?.emoji.name === "🗑️") {
			try {
				const DBUser = await client.db.User.findOne({ id: user?.id });
				const locale = client.locale.getlocale((DBUser?.locale as Tlanguages) ?? "en");
				let BookmarkedMessageID = message.embeds ? message.embeds[0]?.footer?.text : undefined;
				if (!BookmarkedMessageID) return;
				BookmarkedMessageID = BookmarkedMessageID.split("•")
					.map((v) => v.trim())
					.at(1);
				const BookmarkedMessage = await client.db.Bookmark.findOne({ messageID: BookmarkedMessageID });
				BookmarkedMessage?.DM.remove({ messageID: message.id });
				await BookmarkedMessage?.save();
				if (BookmarkedMessage?.DM.length === 0) await client.db.Bookmark.deleteOne({ messageID: BookmarkedMessageID });
			} catch (error) {
				client.log.error(error);
			} finally {
				message.deletable ? await message.delete() : null;
			}
		}
	},
}).return();
