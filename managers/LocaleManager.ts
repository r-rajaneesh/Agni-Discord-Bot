import * as Discord from "discord.js";
import fs from "fs-extra";
import * as globby from "globby";
import ClientManager from "./ClientManager";

export default class Localemanager {
	public locales: { [x in Tlanguages]?: object };
	private client: ClientManager;

	constructor(client: ClientManager) {
		this.client = client;
		this.locales = {};
	}
	public loadLocales() {
		const localeFiles = globby.globbySync(`./locales/*.json`);
		this.client.log.debug(localeFiles);
		localeFiles.forEach((localePath) => {
			const locale: Tlanguages = localePath.split("/").at(-1)?.split(".")[0] as Tlanguages;
			this.locales[locale] = fs.readJSONSync(localePath);
		});
		this.client.log.info(`Successfully loaded ${localeFiles.length} locales.`);
	}
	public convertDiscordLocale(discordlocale: Discord.Locale) {
		const conversiontable: { [x: string]: string } = {
			"en-GB": "en",
			"en-US": "en",
			"es-ES": "en",
			"pt-BR": "pt",
			"sv-SE": "sv",
			"zh-CN": "zh",
			"zh-TW": "zh",
			bg: "bg",
			cs: "cs",
			da: "da",
			de: "de",
			el: "el",
			fi: "fi",
			fr: "fr",
			hi: "hi",
			hr: "hr",
			hu: "hu",
			id: "id",
			it: "it",
			ja: "ja",
			ko: "ko",
			lt: "lt",
			nl: "nl",
			no: "no",
			pl: "pl",
			ro: "ro",
			ru: "ru",
			th: "th",
			tr: "tr",
			uk: "uk",
			vi: "vi",
		};
		return conversiontable[discordlocale as string] as Tlanguages;
	}
	public getlocale(ulocale: Tlanguages) {
		return {
			locale: ulocale,
			t: (gdatapath: string, inputs?: object): string => {
				const locale = ulocale;
				const datapaths = gdatapath
					.replaceAll("][", ".")
					.replaceAll("[", ".")
					.replaceAll("]", ".")
					.split(".")
					.filter((v) => v);
				let currentlevel: any = this.locales[locale];
				// this.client.log.debug(currentlevel)
				// this.client.log.debug(typeof datapaths)
				// this.client.log.debug(datapaths)
				datapaths
					.filter((dp) => dp.length !== 0)
					.forEach((dp: any) => {
						if (Number.isNaN(parseInt(dp))) dp = dp;
						else dp = parseInt(dp);

						// if(!currentlevel) throw new Error(`Expected string/number/object/array, got ${currentlevel}`)
						if (!currentlevel) {
							currentlevel = `Invalid Locale Path.\nContact Developer.`;
							this.client.log.trace(`Invalid locale path, found undefined for ${gdatapath} at ${dp}`);
						} else currentlevel = currentlevel[dp];
					});
				if (!currentlevel) return currentlevel;
				else {
					let result = currentlevel;
					if (inputs && typeof currentlevel === "string") {
						Object.entries(inputs).forEach((entry, i) => {
							const [k, v] = entry;
							result = result.replace(`{{${k}}}`, v);
						});
					}
					return result;
				}
			},
		};
	}
}
