import * as Discord from "discord.js";
import EventBuilder from "../builders/EventBuilder";

export default new EventBuilder({
	name: Discord.Events.MessageCreate,
	once: false,
	isLocked: false,
	execute: async (client, message: Discord.Message) => {
		// const { content, cleanContent, author, channel, guild } = message;

		if (message.author.bot || message.interactionMetadata || message.webhookId) return;
		if (message.partial) message = await message.fetch(true);

		let SavedUser = await client.db.User.findOne({ id: message.author.id });
		let SavedGuild = await client.db.Guild.findOne({ id: message.guildId });

		if (!SavedUser) SavedUser = await client.db.User.create({ id: message.author.id });
		if (!SavedGuild) SavedGuild = await client.db.Guild.create({ id: message.guildId });

		if (!message.content.startsWith(client.config.bot.commands.prefix)) return;

		let argStr = message.content.replace(client.config.bot.commands.prefix, "").split("").join("");
		[...message.content.matchAll(/\".*?\"|\'.*?\'/g)]
			.map((match) => ({
				startindex: match.index as number,
				match: match[0].replaceAll('"', "").replaceAll("'", "") as string,
			}))
			.forEach((quotedArg: { startindex: number; match: string }) => {
				const fstr = message.content.slice(quotedArg.startindex + 1, quotedArg.startindex + quotedArg.match.length + 1);
				argStr = argStr.replace(`"${fstr}"`, fstr.split(" ").join("᲼")).replace(`'${fstr}'`, fstr.split(" ").join("᲼"));
			});
		/* Extracted arguments from quotes */
		const args = argStr.split(" ").map((w: string) => w.replaceAll("᲼", " "));
		let commandName = args?.shift()?.toLowerCase();
		const rawArgs = message.content
			.replace(client.config.bot.commands.prefix, "")
			.replace(commandName as string, "")
			.split(" ")
			.filter((v: string) => v !== "");
		const command: TCommandBuilder = client.messageCommands
			.filter((cmd) => cmd.type === "message")
			.get(commandName as string) as TCommandBuilder;
		if (!command) return;
		const locale = client.locale.getlocale("en");
		if (message.author.id !== client.config.owner.userid) {
			if (command.isOwnerOnly) return;
			if (!command.isLocked)
				return await message.reply({
					embeds: [
						client.makeEmbed({
							title: locale.t("disabled.embeds.title"),
							description: locale.t("disabled.embeds.description", {
								client_name: client.user?.username,
								feature_name: command.name,
								support_server_link: `${client.config.bot.supportServerInvite}`,
							}),
							color: client.config.colours.darkButNotBlack,
						}),
					],
				});
			const commandCooldown: Discord.Collection<string, number> = client.cooldown.get(
				command.name,
			) as Discord.Collection<string, number>;
			if (!command.cooldown) command.cooldown = 5;
			const cooldownTime = new Date().getTime() / 1000 + command.cooldown * 1000;
			if (!commandCooldown.has(message.author.id)) {
				commandCooldown.set(message.author.id, cooldownTime);
				setTimeout(() => {
					commandCooldown.delete(message.author.id);
				}, cooldownTime * 1000);
			}
			return await message.reply({
				embeds: [
					client.makeEmbed({
						title: locale.t("events.messageCreate.cooldown.embeds[0].title"),
						description: locale.t("events.messageCreate.cooldown.embeds[0].description", {
							cooldown_time: new Date().getTime() / 1000 + command.cooldown * 1000,
						}),
						color: client.config.colours.yellow,
					}),
				],
			});
		}
		try {
			await command.execute({ client, message, args, interaction: null, reaction: null, user: null });
		} catch (error) {
			client.log.error(error);
			return await message.reply({
				embeds: [
					client.makeEmbed({
						title: locale.t("events.messageCreate.embeds[0].title"),
						description: locale.t("events.messageCreate.embeds[0].description"),
						color: client.config.colours.red,
					}),
				],
			});
		} finally {
			client.log.info(`[MESSAGE]`, {
				userID: message.author.id,
				commandName: command.name,
				guildID: message.guildId,
				channelID: message.channelId,
				messageID: message.id,
				messageType: Discord.MessageType[message.type],
				timestamp: message.createdTimestamp,
			});
		}
	},
});
