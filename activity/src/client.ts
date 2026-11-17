// What main.ts does with the socket, kept free of Phaser and the DOM so it can be tested:
// routes server messages, gates sends on "ready", and drives prediction every frame.
import type { TClientMsg, TServerMsg } from "@game/protocol";
import type { TConnStatus } from "./net";
import type { Predictor } from "./predict";
import type { ClientState, THints } from "./state";

export interface TGameClientDeps {
	state: ClientState;
	predictor: Predictor;
	send: (m: TClientMsg) => void;
	/** The first welcome: build the scene and the UI */
	start: () => void;
	/** Any later message, after ClientState.apply */
	handle: (h: THints, m: TServerMsg) => void;
	/** The server closed us for good; nothing else arrives after this */
	kicked: (reason: string) => void;
	status?: (s: TConnStatus) => void;
}

export class GameClient {
	private ready = false;
	private started = false;
	private gone = false;

	constructor(private d: TGameClientDeps) {}

	get isReady(): boolean {
		return this.ready && !this.gone;
	}

	onMessage(m: TServerMsg): void {
		if (this.gone) return;
		if (m.t === "kicked") {
			this.gone = true;
			this.ready = false;
			this.d.kicked(m.reason);
			return;
		}
		const hints = this.d.state.apply(m);
		// A welcome is a new instance (or a reconnect): inputs walked in the old one must not replay here
		if (m.t === "welcome") this.d.predictor.reset();
		else if (m.t === "you") this.d.predictor.reconcile(m);
		if (m.t === "welcome" && !this.started) {
			this.started = true;
			this.d.start();
		} else this.d.handle(hints, m);
	}

	onStatus(s: TConnStatus): void {
		if (this.gone) return;
		this.ready = s === "ready";
		// The server dropped our input with the socket, so stop walking until we are back
		if (!this.ready) this.d.predictor.reset();
		this.d.status?.(s);
	}

	/** Sends only while ready; the server kicks a socket that talks before welcome */
	send(m: TClientMsg): void {
		if (this.isReady) this.d.send(m);
	}

	/** One animation frame: send the held direction when due, then walk */
	frame(dtMs: number, dx: -1 | 0 | 1, dy: -1 | 0 | 1): void {
		if (!this.isReady) return;
		const m = this.d.predictor.setInput(dx, dy);
		if (m) this.d.send(m);
		this.d.predictor.advance(dtMs);
	}
}
