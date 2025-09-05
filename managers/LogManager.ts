import moment from "moment";
import fs from "fs-extra";
import path from "path";
import pico from "picocolors";
import pino from "pino";
export default class LogManager {
	private silent: boolean;
	private envs: Map<string, string>;
	// public isSeperateManager: boolean;
	constructor() {
		this.silent = false;
		this.envs = new Map();
		this.loadEnvData();

		// this.isSeperateManager = true;
	}
	private loadEnvData() {
		fs.readFileSync(`${process.cwd()}/.env`)
			.toString()
			.split("\r\n")
			.slice(0, -2)
			.forEach((token) => {
				let [tokenName, tokenValue]: string[] = token.split("=") as string[];

				if (/\s+/g.exec(tokenValue as string)) return;
				if (tokenName !== undefined || tokenValue !== undefined) {
					tokenValue = tokenValue
						?.replace('"', "")
						.split("")
						.reverse()
						.join("")
						.replace('"', "")
						.split("")
						.reverse()
						.join("") as string;
					if (
						tokenValue.length === 0 ||
						tokenValue === "" ||
						tokenValue === undefined ||
						tokenValue === null ||
						tokenName?.match(/\s+/g)
					)
						return;
					this.envs.set(tokenName as string, tokenValue);
				}
				// this.debug(token);
			});
	}
	public silentMode() {
		this.silent = !this.silent;
	}
	private getStackTrace(position?: number) {
		let filePath: string = "";
		if (position === void 0) {
			position = 2;
		}
		if (position >= Error.stackTraceLimit) {
			throw new TypeError(
				"getCallerFile(position) requires position be less then Error.stackTraceLimit but position was: `" +
					position +
					"` and Error.stackTraceLimit was: `" +
					Error.stackTraceLimit +
					"`",
			);
		}
		const oldPrepareStackTrace = Error.prepareStackTrace;
		Error.prepareStackTrace = function (_, stack) {
			return stack;
		};
		const stack = new Error().stack;
		Error.prepareStackTrace = oldPrepareStackTrace;
		if (stack !== null && typeof stack === "object") {
			// stack[0] holds this file
			// stack[1] holds where this function was called
			// stack[2] holds the file we're interested in
			const info: any = stack[position];
			//@ts-ignore
			// console.log(stack[0]?.getFileName(), stack[1]?.getFileName(), stack[2]?.getFileName());
			filePath = info ? info?.getFileName() : "undefined";
		}

		// return `#/${filePath.replace(/\\/g, "/").split("/").slice(3).join("/")}`;
		return `#${filePath.replace(process.cwd(), "").replace(/\\/g, "/")}`;
	}
	private checkLogFile() {
		const year = moment().format("YYYY");
		const month = moment().format("Mo-MMMM");
		const daydate = moment().format("Do-dddd");
		fs.ensureFileSync(path.join("logs", year, month, `${daydate}.log`));
		return path.join("logs", year, month, `${daydate}.log`);
	}
	private getTimeString() {
		return moment().format("dddd Do MMMM DD/MM/YYYY hh:mm:ss A");
	}
	private processLogData(options: { data: any[]; forTerminal?: boolean }) {
		let { data, forTerminal } = options;
		forTerminal = forTerminal ?? false;
		const FinalData: any[] = [];
		data.forEach(async (d) => {
			if (typeof d === "string") d = d.replace(/\u001B/g, "").replace(/\[\d+m/g, "");
			else if (typeof d === "object" && !forTerminal)
				// Log Prettify Objects and not [Object Object] on log files
				d = JSON.stringify(d, null, "\t");
			this.envs.forEach(async (value, key) => {
				if (/\s+/g.exec(value)) return;
				if (typeof d === "string" && !forTerminal) d = d.replace(value, `[REDACTED_${key}]`);
			});
			try {
				if (forTerminal) d = JSON.parse(d);
			} catch (error) {
				d = d;
			}
			FinalData.push(d);
		});
		return FinalData;
	}
	public trace(...data: any[]) {
		const logpath = this.checkLogFile();
		const time = this.getTimeString();
		const trace = this.getStackTrace();
		if (this.silent)
			data = data.map((d) => {
				if (typeof d === "string") return pico.dim(d);
				else return d;
			});
		console.trace(
			`\n\n[${pico.cyan("TRACE")}] - [${pico.gray(time)}] - [${pico.gray(trace)}]  ❯\t`,
			...this.processLogData({ data: data, forTerminal: true }),
		);
		// fs.appendFileSync(logpath, `\n\n[TRACE] - [${time}] - [${trace}] ❯\t${this.processLogData({ data: data })}`, {
		// 	encoding: "utf8",
		// });
		// fs.appendFileSync(logpath, `\n\n[TRACE] - [${time}] - [${trace}] ❯\t${this.processLogData({ data: data })}`, {
		// 	encoding: "utf8",
		// });
	}
	public info(...data: any[]) {
		const logpath = this.checkLogFile();
		const time = this.getTimeString();
		const trace = this.getStackTrace();
		if (this.silent)
			data = data.map((d) => {
				if (typeof d === "string") return pico.dim(d);
				else return d;
			});
		console.info(
			`\n\n[${pico.blue("INFO")}] - [${pico.gray(time)}] - [${pico.gray(trace)}]  ❯\t`,
			...this.processLogData({ data: data, forTerminal: true }),
		);
		// fs.appendFileSync(logpath, `\n\n[INFO] - [${time}] - [${trace}] ❯\t${this.processLogData({ data: data })}`, {
		// 	encoding: "utf8",
		// });
		fs.appendFileSync(
			logpath,
			`\n${JSON.stringify({
				type: "INFO",
				timestamp: moment().utc().unix(),
				time,
				trace,
				data: this.processLogData({ data: data }),
			})}`,
			{
				encoding: "utf8",
			},
		);
	}
	public debug(...data: any[]) {
		if (process.argv[2] !== "--debug") return;
		const logpath = this.checkLogFile();
		const time = this.getTimeString();
		const trace = this.getStackTrace();
		if (this.silent)
			data = data.map((d) => {
				if (typeof d === "string") return pico.dim(d);
				else return d;
			});
		console.debug(
			`\n\n[${pico.yellow("DEBUG")}] - [${pico.gray(time)}] - [${pico.gray(trace)}]  ❯\t`,
			...this.processLogData({ data: data, forTerminal: true }),
		);
		// fs.appendFileSync(logpath, `\n\n[DEBUG] - [${time}] - [${trace}] ❯\t${this.processLogData({ data: data })}`, {
		// 	encoding: "utf8",
		// });
		fs.appendFileSync(
			logpath,
			`\n${JSON.stringify({
				type: "DEBUG",
				timestamp: moment().utc().unix(),
				time,
				trace,
				data: this.processLogData({ data: data }),
			})}`,
			{
				encoding: "utf8",
			},
		);
	}
	public warn(...data: any[]) {
		const logpath = this.checkLogFile();
		const time = this.getTimeString();
		const trace = this.getStackTrace();
		if (this.silent) {
			data = data.map((d) => {
				if (typeof d === "string") return pico.dim(d);
				else return d;
			});
		}
		console.warn(
			`\n\n[${pico.yellow(pico.underline("WARN"))}] - [${pico.gray(time)}] - [${pico.gray(trace)}]  ❯\t`,
			this.processLogData({ data: data, forTerminal: true }),
		);
		// fs.appendFileSync(logpath, `\n\n[WARN] - [${time}] - [${trace}] ❯\t${this.processLogData({ data: data })}`, {
		// 	encoding: "utf8",
		// });
		fs.appendFileSync(
			logpath,
			`\n${JSON.stringify({
				type: "WARN",
				timestamp: moment().utc().unix(),
				time,
				trace,
				data: this.processLogData({ data: data }),
			})}`,
			{
				encoding: "utf8",
			},
		);
	}
	public error(...data: any[]) {
		const logpath = this.checkLogFile();
		const time = this.getTimeString();
		const trace = this.getStackTrace();
		if (this.silent)
			data = data.map((d) => {
				if (typeof d === "string") return pico.dim(d);
				else return d;
			});
		console.log(
			`\n\n[${pico.red("ERROR")}] - [${pico.gray(time)}] - [${pico.gray(trace)}]  ❯\t`,
			...this.processLogData({ data: data, forTerminal: true }),
		);
		// fs.appendFileSync(logpath, `\n\n[ERROR] - [${time}] - [${trace}] ❯\t${this.processLogData({ data: data })}`, {
		// 	encoding: "utf8",
		// });
		fs.appendFileSync(
			logpath,
			`\n${JSON.stringify({
				type: "ERROR",
				timestamp: moment().utc().unix(),
				time,
				trace,
				data: this.processLogData({ data: data }),
			})}`,
			{
				encoding: "utf8",
			},
		);
	}
	public critical(...data: any[]) {
		const logpath = this.checkLogFile();
		const time = this.getTimeString();
		const trace = this.getStackTrace();
		if (this.silent)
			data = data.map((d) => {
				if (typeof d === "string") return pico.dim(d);
				else return d;
			});
		console.error(
			`\n\n[${pico.red(pico.underline("CRITICAL"))}] - [${pico.gray(time)}] - [${pico.gray(trace)}]  ❯\t`,
			this.processLogData({ data: data, forTerminal: true }),
		);
		// fs.appendFileSync(logpath, `\n\n[CRITICAL] - [${time}] - [${trace}] ❯\t${this.processLogData({ data: data })}`, {
		// 	encoding: "utf8",
		// });
		fs.appendFileSync(
			logpath,
			`\n${JSON.stringify({
				type: "CRITICAL",
				timestamp: moment().utc().unix(),
				time,
				trace,
				data: this.processLogData({ data: data }),
			})}`,
			{
				encoding: "utf8",
			},
		);
	}
}
