import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

// Build the Activity client before the bot serves it
if (!existsSync("activity/node_modules")) execSync("bun install --frozen-lockfile", { cwd: "activity", stdio: "inherit" });
execSync("bun run activity:build", { stdio: "inherit" });

export default {
	name: "Agni Discord Bot",
	script: "bun",
	args: "index.js",
	interpreter: "none",
	env: {
		PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
	},
};
