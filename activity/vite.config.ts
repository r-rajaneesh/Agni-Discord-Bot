import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

// The client id is baked in at build time; without it the Activity can't start, so the build stops
function requireClientId(): Plugin {
	let env: Record<string, string> = {};
	let build = false;
	return {
		name: "require-client-id",
		configResolved(config) {
			env = config.env;
			build = config.command === "build";
		},
		buildStart() {
			if (build && !env.VITE_DISCORD_CLIENT_ID) this.error("VITE_DISCORD_CLIENT_ID is not set: add it to the repo root .env");
		},
	};
}

export default defineConfig({
	// One .env at the repo root serves the bot and the Activity; Vite only exposes its VITE_ variables
	envDir: fileURLToPath(new URL("..", import.meta.url)),
	// game/data/products.ts reads Discord SKU ids from the server's env; the browser has none
	define: { "process.env": "{}" },
	plugins: [requireClientId()],
	resolve: {
		alias: { "@game": fileURLToPath(new URL("../game", import.meta.url)) },
	},
	server: {
		// Discord reaches the dev server through a tunnel
		allowedHosts: true,
		proxy: {
			"/api": "http://localhost:3000",
			"/ws": { target: "ws://localhost:3000", ws: true },
		},
	},
});
