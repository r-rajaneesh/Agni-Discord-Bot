import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
	// game/data/products.ts reads Discord SKU ids from the server's env; the browser has none
	define: { "process.env": "{}" },
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
