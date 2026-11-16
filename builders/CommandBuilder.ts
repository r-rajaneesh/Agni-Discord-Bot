import * as Discord from "discord.js";
import type ClientManager from "../managers/ClientManager";

class CommandBuilder {
	public name: string;
	public description: string;
	public permissions: Discord.PermissionsBitField[];
	public isOwnerOnly: boolean;
	public isLocked: boolean;
	public type: TCommandBuilder["type"];
	public customIdPrefix?: string;
	public cooldown: number;
	public builder?: TCommandBuilder["builder"];
	public execute: TCommandBuilder["execute"];
	constructor(CommandBuilderOptions: TCommandBuilder) {
		this.name = CommandBuilderOptions.name;
		this.description = CommandBuilderOptions.description;
		this.permissions = CommandBuilderOptions.permissions;
		this.isOwnerOnly = CommandBuilderOptions.isOwnerOnly;
		this.isLocked = CommandBuilderOptions.isLocked;
		this.type = CommandBuilderOptions.type;
		this.customIdPrefix = CommandBuilderOptions.customIdPrefix;
		this.builder = CommandBuilderOptions.builder;
		this.cooldown = CommandBuilderOptions.cooldown ?? 3000;
		this.execute = CommandBuilderOptions.execute;
	}
	public return() {
		return this;
	}
}
export default CommandBuilder;
