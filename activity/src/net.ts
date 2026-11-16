import type { TClientMsg, TServerMsg } from "@game/protocol";

// "open" = socket up, hello sent. "ready" = welcome received, sends allowed.
export type TConnStatus = "connecting" | "open" | "ready" | "closed";

export interface TConnectionOpts {
	url: string;
	hello: () => TClientMsg;
	onMessage: (m: TServerMsg) => void;
	onStatus: (s: TConnStatus) => void;
	WebSocketImpl?: typeof WebSocket;
	setTimeoutImpl?: typeof setTimeout;
	clearTimeoutImpl?: typeof clearTimeout;
}

const BASE_DELAY = 500;
const MAX_DELAY = 8000;

export class Connection {
	private ws: WebSocket | null = null;
	private ready = false;
	private stopped = false;
	private attempt = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(private opts: TConnectionOpts) {
		this.connect();
	}

	// The server kicks any socket that talks before welcome, so only hello goes out until then
	send(m: TClientMsg): void {
		if (!this.ready || !this.ws) return;
		this.ws.send(JSON.stringify(m));
	}

	close(): void {
		this.stopped = true;
		if (this.timer !== null) (this.opts.clearTimeoutImpl ?? clearTimeout)(this.timer);
		this.timer = null;
		this.ws?.close();
	}

	private connect(): void {
		this.timer = null;
		if (this.stopped) return;
		const WS = this.opts.WebSocketImpl ?? WebSocket;
		this.ready = false;
		this.opts.onStatus("connecting");
		const ws = new WS(this.opts.url);
		this.ws = ws;
		ws.onopen = () => {
			ws.send(JSON.stringify(this.opts.hello()));
			this.opts.onStatus("open");
		};
		ws.onmessage = (e) => {
			if (this.ws !== ws) return;
			let m: TServerMsg;
			try {
				m = JSON.parse(String(e.data)) as TServerMsg;
			} catch {
				return;
			}
			if (m.t === "welcome") {
				this.ready = true;
				this.attempt = 0;
				this.opts.onStatus("ready");
			} else if (m.t === "kicked") {
				this.stopped = true;
			}
			this.opts.onMessage(m);
		};
		// onerror is intentionally unhandled: close always follows an error
		ws.onclose = () => {
			if (this.ws !== ws) return;
			this.ready = false;
			this.opts.onStatus("closed");
			if (this.stopped) return;
			const delay = Math.min(BASE_DELAY * 2 ** this.attempt, MAX_DELAY);
			this.attempt++;
			this.timer = (this.opts.setTimeoutImpl ?? setTimeout)(() => this.connect(), delay);
		};
	}
}

export function wsUrl(): string {
	return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}
