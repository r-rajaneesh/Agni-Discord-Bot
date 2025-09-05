module.exports = {
	name: "Agni Discord Bot",
	script: "index.ts",
	interpreter: "bun",
	env: {
		PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
	},
};
