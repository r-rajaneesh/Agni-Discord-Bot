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
	// Bun loads .env into process.env, so redact from there. Short values are skipped
	// to avoid redacting common words like "true" or port numbers.
	private loadEnvData() {
		Object.entries(process.env).forEach(([key, value]) => {
			if (!value || value.length < 8 || /\s/.test(value)) return;
			if (/^(PATH|HOME|PWD|OLDPWD|SHELL|USER|LOGNAME|TERM|LANG|_)$/.test(key) || key.startsWith("XDG_")) return;
			this.envs.set(key, value);
		});
	}
	private writeQueue: string[] = [];
	private writing = false;
	private ensuredFiles = new Set<string>();
	// Appends asynchronously and in order, so logging never blocks the event loop.
	private write(logpath: string, line: string) {
		this.writeQueue.push(`${logpath}\u0000${line}`);
		if (!this.writing) void this.drain();
	}
	private async drain() {
		this.writing = true;
		while (this.writeQueue.length) {
			const batch = this.writeQueue.splice(0);
			const byFile = new Map<string, string>();
			batch.forEach((entry) => {
				const [file, line] = entry.split("\u0000") as [string, string];
				byFile.set(file, (byFile.get(file) ?? "") + line);
			});
			for (const [file, lines] of byFile) await fs.appendFile(file, lines, { encoding: "utf8" }).catch(() => {});
		}
		this.writing = false;
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
		const logpath = path.join("logs", year, month, `${daydate}.log`);
		if (!this.ensuredFiles.has(logpath)) {
			fs.ensureFileSync(logpath);
			this.ensuredFiles.add(logpath);
		}
		return logpath;
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
				if (typeof d === "string" && !forTerminal) d = d.replaceAll(value, `[REDACTED_${key}]`);
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
		this.write(
			logpath,
			`\n${JSON.stringify({
				type: "INFO",
				timestamp: moment().utc().unix(),
				time,
				trace,
				data: this.processLogData({ data: data }),
			})}`,
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
		this.write(
			logpath,
			`\n${JSON.stringify({
				type: "DEBUG",
				timestamp: moment().utc().unix(),
				time,
				trace,
				data: this.processLogData({ data: data }),
			})}`,
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
		this.write(
			logpath,
			`\n${JSON.stringify({
				type: "WARN",
				timestamp: moment().utc().unix(),
				time,
				trace,
				data: this.processLogData({ data: data }),
			})}`,
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
		this.write(
			logpath,
			`\n${JSON.stringify({
				type: "ERROR",
				timestamp: moment().utc().unix(),
				time,
				trace,
				data: this.processLogData({ data: data }),
			})}`,
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
		this.write(
			logpath,
			`\n${JSON.stringify({
				type: "CRITICAL",
				timestamp: moment().utc().unix(),
				time,
				trace,
				data: this.processLogData({ data: data }),
			})}`,
		);
	}
}
