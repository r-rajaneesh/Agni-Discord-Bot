export default {
	name: "Agni Discord Bot",
	script: "bun",
	args: "index.js",
	interpreter: "none",
	// Shutdown drains game queues for up to 5 s, then saves players
	kill_timeout: 10000,
	env: {
		PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
	},
};
