import * as Discord from "discord.js";
import type ClientManager from "../managers/ClientManager";

class ContextMenuBuilder {
	public name: string;
	public description: string;
	public permissions: Discord.PermissionsBitField[];
	public isOwnerOnly: boolean;
	public isLocked: boolean;
	public cooldown: number;
	public contextmenu: Discord.ContextMenuCommandBuilder;
	public execute: (options: {
		client: ClientManager;
		message: Discord.Message;
		args: string[];
		interaction: Discord.ContextMenuCommandInteraction;
	}) => Promise<void>;
	constructor(CommandBuilderOptions: TContextMenuBuilder) {
		this.name = CommandBuilderOptions.name;
		this.description = CommandBuilderOptions.description;
		this.permissions = CommandBuilderOptions.permissions;
		this.isOwnerOnly = CommandBuilderOptions.isOwnerOnly;
		this.isLocked = CommandBuilderOptions.isLocked;
		this.contextmenu = CommandBuilderOptions.contextmenu;
		this.cooldown = CommandBuilderOptions.cooldown ?? 3000;
		this.execute = CommandBuilderOptions.execute;
	}
	public return() {
		return this;
	}
}
export default ContextMenuBuilder;
