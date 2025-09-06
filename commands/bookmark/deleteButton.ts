import CommandBuilder from "@root/builders/CommandBuilder";

export default new CommandBuilder({
	name: "bookmark-delete",
	description: "Deletes bookmark from the DM",
	type: "button",
	isLocked: false,
	isOwnerOnly: false,
	permissions: [],
	execute: async ({ client, interaction }) => {
		client.log.debug("Test");
		if (!interaction || !interaction.isButton() || !interaction.channel?.isDMBased()) return;
		await interaction.deferUpdate({ withResponse: true });
		try {
			const DBUser = await client.db.User.findOne({ id: interaction.user.id });
			const locale = client.locale.getlocale((DBUser?.locale as Tlanguages) ?? "en");
			let BookmarkedMessageID = interaction.message.embeds ? interaction.message.embeds[0]?.footer?.text : undefined;
			if (!BookmarkedMessageID) return;
			BookmarkedMessageID = BookmarkedMessageID.split("•")
				.map((v) => v.trim())
				.at(1);
			const BookmarkedMessage = await client.db.Bookmark.findOne({ messageID: BookmarkedMessageID });
			BookmarkedMessage?.DM.remove({ messageID: interaction.message.id });
			await BookmarkedMessage?.save();
			if ((await client.db.Bookmark.findOne({ messageID: BookmarkedMessageID }))?.DM.length === 0)
				await client.db.Bookmark.deleteOne({ messageID: BookmarkedMessageID });
		} catch (error) {
			client.log.error(error);
		} finally {
			await interaction.message.delete();
		}
	},
}).return();
