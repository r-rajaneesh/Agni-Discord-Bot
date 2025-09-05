import * as Discord from "discord.js";
import ClientManager from "../managers/ClientManager";
declare global {
	interface TEventBuilder {
		name: keyof Discord.ClientEvents;
		once: boolean;
		isLocked: boolean;
		filePath?: string;
		execute(client: ClientManager, ...args: any): void;
	}
	interface TCommandBuilder {
		name: string;
		alias?: string[];
		description: string;
		permissions: Discord.PermissionsBitField[];
		isOwnerOnly: boolean;
		filePath?: string;
		isLocked: boolean;
		type: "message" | "slash_command" | "contextmenu" | "button" | "select" | "reaction";
		cooldown?: number;
		builder?: Discord.SlashCommandBuilder | Discord.ContextMenuCommandBuilder | Discord.ButtonBuilder;
		execute(options: {
			client: ClientManager;
			message: Discord.Message | null;
			reaction: Discord.MessageReaction | null;
			args: string[] | null;
			user: Discord.User | null;
			interaction:
				| Discord.Interaction
				| Discord.CommandInteraction
				| Discord.ContextMenuCommandInteraction
				| Discord.ButtonInteraction
				| Discord.AnySelectMenuInteraction
				| null;
		}): Promise<any>;
	}
	interface TContextMenuBuilder {
		name: string;
		alias?: string[];
		description: string;
		permissions: Discord.PermissionsBitField[];
		isOwnerOnly: boolean;
		filePath?: string;
		isLocked: boolean;
		cooldown?: number;
		contextmenu: Discord.ContextMenuCommandBuilder;
		execute(options: { client: ClientManager; interaction: Discord.ContextMenuCommandInteraction }): Promise<any>;
	}
	enum TCommandBuilderType {
		Button = "button",
		StringSelect = "string_select",
		UserSelect = "user_select",
		RoleSelect = "role_select",
		MentionableSelect = "mentionable_select",
		ChannelSelect = "channel_select",
		Message = "message",
		SlashCommand = "slash_command",
		ContextMenu = "contextmenu",
	}

	type Tlanguages =
		| "af"
		| "sq"
		| "am"
		| "ar"
		| "hy"
		| "az"
		| "eu"
		| "be"
		| "bn"
		| "bs"
		| "bg"
		| "ca"
		| "ceb"
		| "ny"
		| "zh-cn"
		| "zh-tw"
		| "co"
		| "hr"
		| "cs"
		| "da"
		| "nl"
		| "en"
		| "eo"
		| "et"
		| "tl"
		| "fi"
		| "fr"
		| "fy"
		| "gl"
		| "ka"
		| "de"
		| "el"
		| "gu"
		| "ht"
		| "ha"
		| "haw"
		| "iw"
		| "hi"
		| "hmn"
		| "hu"
		| "is"
		| "ig"
		| "id"
		| "ga"
		| "it"
		| "ja"
		| "jw"
		| "kn"
		| "kk"
		| "km"
		| "ko"
		| "ku"
		| "ky"
		| "lo"
		| "la"
		| "lv"
		| "lt"
		| "lb"
		| "mk"
		| "mg"
		| "ms"
		| "ml"
		| "mt"
		| "mi"
		| "mr"
		| "mn"
		| "my"
		| "ne"
		| "no"
		| "ps"
		| "fa"
		| "pl"
		| "pt"
		| "pa"
		| "ro"
		| "ru"
		| "sm"
		| "gd"
		| "sr"
		| "st"
		| "sn"
		| "sd"
		| "si"
		| "sk"
		| "sl"
		| "so"
		| "es"
		| "su"
		| "sw"
		| "sv"
		| "tg"
		| "ta"
		| "te"
		| "th"
		| "tr"
		| "uk"
		| "ur"
		| "uz"
		| "vi"
		| "cy"
		| "xh"
		| "yi"
		| "yo"
		| "zu";
}
export declare enum TCommandBuilderType {
	Button = "button",
	StringSelect = "string_select",
	UserSelect = "user_select",
	RoleSelect = "role_select",
	MentionableSelect = "mentionable_select",
	ChannelSelect = "channel_select",
	Message = "message",
	SlashCommand = "slash_command",
	ContextMenu = "contextmenu",
}
