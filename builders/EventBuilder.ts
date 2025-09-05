import * as Discord from "discord.js";
import type ClientManager from "../managers/ClientManager";

class EventBuilder {
	public name: keyof Discord.ClientEvents;
	public once: boolean;
	public isLocked: boolean;
	public execute: (client: ClientManager, ...args: any) => void;
	constructor(EventBuilderOptions: TEventBuilder) {
		this.name = EventBuilderOptions.name;
		this.once = EventBuilderOptions.once;
		this.isLocked = EventBuilderOptions.isLocked;
		this.execute = EventBuilderOptions.execute;
	}
	public return() {
		return this;
	}
}
export default EventBuilder;
