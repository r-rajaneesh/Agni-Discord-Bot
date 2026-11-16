import CommandBuilder from "@Builders/CommandBuilder";
import type { TInput, TView } from "@Managers/GameManager";

const DIRS = new Set(["u", "d", "l", "r"]);
const VIEWS = new Set<TView>(["game", "shop", "inventory", "players", "help"]);

// customIds: farm:mv:<dir> | farm:use | farm:eq | farm:menu | farm:view:<view> | farm:buy | farm:sell
function parse(customId: string, value?: string): TInput | null {
	const [, action, arg] = customId.split(":");
	switch (action) {
		case "mv":
			return arg && DIRS.has(arg) ? { kind: "move", dir: arg as "u" | "d" | "l" | "r" } : null;
		case "use":
			return { kind: "use" };
		case "eq":
			return value ? { kind: "equip", item: value } : null;
		case "menu":
			if (value === "sleep") return { kind: "sleep" };
			return value && VIEWS.has(value as TView) ? { kind: "view", view: value as TView } : null;
		case "view":
			return arg && VIEWS.has(arg as TView) ? { kind: "view", view: arg as TView } : null;
		case "buy": {
			const [item, qty] = (value ?? "").split(":");
			return item && Number(qty) > 0 ? { kind: "buy", item, qty: Number(qty) } : null;
		}
		case "sell": {
			const [item, qty] = (value ?? "").split(":");
			if (!item) return null;
			return { kind: "sell", item, qty: qty === "all" ? "all" : Number(qty) };
		}
	}
	return null;
}

export default new CommandBuilder({
	name: "farm-controls",
	description: "Buttons and menus of the farm viewport",
	permissions: [],
	isLocked: false,
	isOwnerOnly: false,
	type: "button",
	customIdPrefix: "farm",
	cooldown: 0,
	execute: async ({ client, interaction }) => {
		if (!interaction?.isMessageComponent()) return;
		const value = interaction.isStringSelectMenu() ? interaction.values[0] : undefined;
		const input = parse(interaction.customId, value);
		if (!input) return interaction.deferUpdate();
		await client.game.input(interaction, input);
	},
}).return();
