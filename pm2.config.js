export default {
	name: "Agni Discord Bot",
	script: "bun",
	args: "index.js",
	interpreter: "none",
	env: {
		PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
	},
};
