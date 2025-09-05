import * as Discord from "discord.js";
import type ClientManager from "../managers/ClientManager";

class CommandBuilder {
	public name: string;
	public description: string;
	public permissions: Discord.PermissionsBitField[];
	public isOwnerOnly: boolean;
	public isLocked: boolean;
	public type: "message" | "slash_command" | "contextmenu" | "button" | "select" | "reaction";
	public cooldown: number;
	public builder?: Discord.SlashCommandBuilder | Discord.ContextMenuCommandBuilder | Discord.ButtonBuilder;
	public execute: (options: {
		client: ClientManager;
		message: Discord.Message | Discord.MessageReaction | null;
		args: string[];
		interaction:
			| Discord.Interaction
			| Discord.CommandInteraction
			| Discord.ContextMenuCommandInteraction
			| Discord.ButtonInteraction
			| Discord.AnySelectMenuInteraction
			| null;
	}) => Promise<any>;
	constructor(CommandBuilderOptions: TCommandBuilder) {
		this.name = CommandBuilderOptions.name;
		this.description = CommandBuilderOptions.description;
		this.permissions = CommandBuilderOptions.permissions;
		this.isOwnerOnly = CommandBuilderOptions.isOwnerOnly;
		this.isLocked = CommandBuilderOptions.isLocked;
		this.type = CommandBuilderOptions.type;
		this.builder = CommandBuilderOptions.builder;
		this.cooldown = CommandBuilderOptions.cooldown ?? 3000;
		this.execute = CommandBuilderOptions.execute;
	}
	public return() {
		return this;
	}
}
export default CommandBuilder;
