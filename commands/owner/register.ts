import CommandBuilder from "@Builders/CommandBuilder";

export default new CommandBuilder({
	name: "register",
	description: "Force re-register application commands",
	permissions: [],
	isLocked: false,
	isOwnerOnly: true,
	type: "message",
	execute: async ({ client, message }) => {
		await client.registerCommands(true);
		await message?.reply({
			embeds: [
				client.makeEmbed({
					title: "Registered",
					description: "Application commands re-registered.",
					color: client.config.colours.green,
				}),
			],
		});
	},
}).return();
