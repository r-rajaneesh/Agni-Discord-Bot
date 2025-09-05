import * as Discord from "discord.js";
import CommandBuilder from "@Builders/CommandBuilder";

export default new CommandBuilder({
	name: "test",
	description: "A test command",
	permissions: [],
	isLocked: false,
	isOwnerOnly: true,
	type: "message",
	execute: async ({ client, message, interaction, args }) => {
		await message?.reply({
			flags: [Discord.MessageFlags.IsComponentsV2],
			components: [
				new Discord.ContainerBuilder()
					.setId(10)
					.addTextDisplayComponents(
						new Discord.TextDisplayBuilder().setId(11).setContent("Hello World!"),
						new Discord.TextDisplayBuilder().setId(12).setContent("Agni Testing!"),
					)
					.addSeparatorComponents(
						new Discord.SeparatorBuilder().setId(21).setDivider(true).setSpacing(Discord.SeparatorSpacingSize.Small),
					)
					.addActionRowComponents(
						new Discord.ActionRowBuilder<Discord.ButtonBuilder>()
							.setId(31)
							.addComponents(
								new Discord.ButtonBuilder()
									.setId(311)
									.setCustomId(`clik-button`)
									.setLabel(`Click Here`)
									.setStyle(Discord.ButtonStyle.Primary)
									.setEmoji({ name: `👆🏻` }),
								new Discord.ButtonBuilder()
									.setId(312)
									.setCustomId(`middle-button`)
									.setLabel(`Middle`)
									.setStyle(Discord.ButtonStyle.Secondary)
									.setEmoji({ name: `✨` }),
								new Discord.ButtonBuilder()
									.setId(313)
									.setCustomId(`x`)
									.setLabel(`Last Before`)
									.setStyle(Discord.ButtonStyle.Danger)
									.setEmoji({ name: `✖️` }),
								new Discord.ButtonBuilder()
									.setId(314)
									// .setCustomId(`rickroll`)
									.setLabel(`Last Before`)
									.setStyle(Discord.ButtonStyle.Link)
									.setURL(`https://google.com/search?q=rickroll`)
									.setEmoji({ name: `🔪` }),
								new Discord.ButtonBuilder()
									.setId(316)
									.setCustomId(`last-button`)
									.setLabel(`Last Button`)
									.setStyle(Discord.ButtonStyle.Success)
									.setEmoji({ name: `🔚` }),
							),
					).toJSON(),
			],
		});
	},
});
