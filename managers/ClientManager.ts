import * as Discord from "discord.js";
import type TClientConfig from "../config.ts";
import ClientConfig from "../config.ts";
import * as globby from "globby";
import DatabaseManager from "./DatabaseManager.ts";
import Localemanager from "./LocaleManager.ts";
import LogManager from "./LogManager.ts";
import mongoose from "mongoose";

class ClientManager extends Discord.Client {
	public ClientOptions: Discord.ClientOptions;
	public log: LogManager;
	public events: Discord.Collection<string, TEventBuilder>;
	public messageCommands: Discord.Collection<string, TCommandBuilder>;
	public applicationCommands: Discord.Collection<string, TCommandBuilder>;
	public cooldown: Discord.Collection<unknown, unknown>;
	public db: typeof DatabaseManager;
	public config: typeof TClientConfig;
	public locale: Localemanager;
	public REST: Discord.REST;

	constructor(
		ClientOptions: Discord.ClientOptions = {
			intents: [
				"AutoModerationConfiguration",
				"AutoModerationExecution",
				"DirectMessagePolls",
				"DirectMessageReactions",
				"DirectMessages",
				"DirectMessageTyping",
				"GuildBans",
				"GuildEmojisAndStickers",
				"GuildExpressions",
				"GuildIntegrations",
				"GuildInvites",
				"GuildMembers",
				"GuildMessageReactions",
				"GuildMessages",
				"GuildMessageTyping",
				"GuildModeration",
				"GuildPresences",
				"Guilds",
				"GuildScheduledEvents",
				"GuildVoiceStates",
				"GuildWebhooks",
				"MessageContent",
			],
			partials: [
				Discord.Partials.Channel,
				Discord.Partials.GuildMember,
				Discord.Partials.Message,
				Discord.Partials.Reaction,
				Discord.Partials.ThreadMember,
				Discord.Partials.User,
				Discord.Partials.GuildScheduledEvent,
				Discord.Partials.SoundboardSound,
			],
			allowedMentions: {
				parse: ["everyone", "roles", "users"],
				repliedUser: true,
			},
			presence: {
				afk: false,
				status: "online",
				activities: [
					{
						name: `Online at ${
							new Date().getHours() % 12 < 10 ? `0${new Date().getHours() % 12}` : new Date().getHours() % 12 || 12
						}:${new Date().getMinutes() < 10 ? `0${new Date().getMinutes()}` : new Date().getMinutes()}`,
						type: Discord.ActivityType.Watching,
					},
				],
			},
		},
	) {
		super(ClientOptions);
		this.ClientOptions = ClientOptions;
		this.log = new LogManager();
		this.db = DatabaseManager;
		this.config = ClientConfig;
		this.locale = new Localemanager(this);
		this.REST = new Discord.REST({ version: "10" }).setToken(process.env.BOT_TOKEN as string);
		// Collections
		this.events = new Discord.Collection();
		this.messageCommands = new Discord.Collection();
		this.applicationCommands = new Discord.Collection();
		this.cooldown = new Discord.Collection();
		this.loadEssentials();
	}
	public async loadEssentials() {
		this.locale.loadLocales();
		this.connectDatabase();
		this.loadCommands();
		this.loadEvents();
	}
	public async connectDatabase() {
		try {
			await mongoose.connect("mongodb://localhost:27017/agni", { appName: "Agni Preview" });
			this.log.info("Successfully connected to the Mongo Database");
		} catch (error) {
			this.log.error(error);
		}
	}
	public async loadEvents() {
		globby.globbySync("./events/**/*.ts").forEach((eventPath) => {
			this.log.debug(`Loading Event: ${eventPath}`);
			delete require.cache[require.resolve(eventPath.replace("./", "../"))];
			const { default: event }: { default: TEventBuilder } = require(eventPath.replace("./", "../"));

			this.events.set(event.name, event);
			if (event.once) {
				this.once(event.name, (...args) => event.execute(this, ...args));
			} else {
				this.on(event.name, (...args) => event.execute(this, ...args));
			}
		});
		this.log.info(`Successfully loaded ${this.events.toJSON().length} Events.`);
	}
	public async loadCommands() {
		globby.globbySync("./commands/**/*.ts").forEach((commandPath) => {
			this.log.debug(`Loading Command: ${commandPath}`);
			delete require.cache[require.resolve(commandPath.replace("./", "../"))];
			const { default: command }: { default: TCommandBuilder } = require(commandPath.replace("./", "../"));
			command.filePath = commandPath.replace("../", "./");
			if (command.type === "message" || command.type === "reaction") {
				command.alias?.forEach((alia) => this.messageCommands.set(alia, command));
				this.messageCommands.set(command.name, command);
			} else if (
				command.type === "slash_command" ||
				command.type === "contextmenu" ||
				command.type === "button" ||
				command.type === "select"
			) {
				this.applicationCommands.set(command.name, command);
			}
		});
		this.log.info(`Successfully loaded ${this.messageCommands.toJSON().length} Message Commands.`);
		this.log.info(`Successfully loaded ${this.applicationCommands.toJSON().length} Application Commands.`);
		this.log.debug(this.applicationCommands.toJSON());
		this.log.debug(this.messageCommands.toJSON());
	}
	public async registerCommands() {
		await this.REST.put(Discord.Routes.applicationCommands(this.user?.id as string), {
			body: this.applicationCommands
				.filter((cmd) => cmd.type === "slash_command" || cmd.type === "contextmenu")
				.map((cmd) => cmd.builder?.toJSON()),
		});

		this.log.info(
			`Successfully registered ${
				this.applicationCommands.filter((cmd) => cmd.type === "slash_command" || cmd.type === "contextmenu").toJSON()
					.length
			} Application Commands`,
		);
	}
	public makeEmbed(data: Discord.EmbedData | Discord.APIEmbed) {
		const embed = new Discord.EmbedBuilder();
		if (data?.title) embed.setTitle(data?.title);
		if (data?.url) embed.setURL(data?.url);
		if (data?.description) embed.setDescription(data?.description);
		if (data?.author)
			embed.setAuthor({
				name: data?.author.name ?? null,
				//@ts-ignore
				iconURL: data?.author?.iconURL ?? undefined,
				url: data?.author.url ?? undefined,
			});
		if (data?.footer)
			embed.setFooter({
				text: data?.footer.text ?? null,
				iconURL: (data as Discord.EmbedData)?.footer?.iconURL,
			});
		if (data?.thumbnail) embed.setThumbnail(data?.thumbnail.url);
		if (data?.image) embed.setImage(data?.image.url);
		if (data?.fields) {
			data.fields.forEach(async (e, i) => {
				if (i > 25) return;
				embed.addFields([
					{
						name: e.name ?? null,
						value: e.value ?? null,
						inline: e.inline ?? false,
					},
				]);
			});
		}
		if (!data?.timestamp) embed.setTimestamp(new Date());
		else embed.setTimestamp(new Date(data?.timestamp));
		embed.setColor(data?.color ?? this.config.colours.embed);
		return embed;
	}
	public pageEmbed(embeds: Discord.Embed[]) {
		let EmbedIndex = 0;
		return {
			value: embeds.at(EmbedIndex),
			next: function () {
				EmbedIndex++;
				if (EmbedIndex > embeds.length - 1) EmbedIndex = 0;
				this.value = embeds.at(EmbedIndex);
				return this.value;
			},
			prev: function () {
				EmbedIndex--;
				if (EmbedIndex < -embeds.length + 1) EmbedIndex = -1;
				this.value = embeds.at(EmbedIndex);
				return this.value;
			},
		};
	}
}
export default ClientManager;
