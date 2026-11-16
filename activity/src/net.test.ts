import { expect, test } from "bun:test";
import type { TClientMsg, TServerMsg } from "@game/protocol";
import { Connection } from "./net";

class FakeWS {
	static all: FakeWS[] = [];
	sent: string[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((e: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	readyState = 0;
	constructor(public url: string) {
		FakeWS.all.push(this);
	}
	send(d: string) {
		this.sent.push(d);
	}
	close() {
		this.readyState = 3;
		this.onclose?.();
	}
	open() {
		this.readyState = 1;
		this.onopen?.();
	}
	recv(m: TServerMsg) {
		this.onmessage?.({ data: JSON.stringify(m) });
	}
	drop() {
		this.readyState = 3;
		this.onclose?.();
	}
}

const HELLO: TClientMsg = { t: "hello", v: 1, token: "t", instanceId: "i", guildId: null };
const WELCOME = { t: "welcome", userId: "u", snapshot: {} } as unknown as TServerMsg;

function setup() {
	FakeWS.all = [];
	const delays: number[] = [];
	const timers: (() => void)[] = [];
	const statuses: string[] = [];
	const msgs: TServerMsg[] = [];
	const conn = new Connection({
		url: "ws://x/ws",
		hello: () => HELLO,
		onMessage: (m) => msgs.push(m),
		onStatus: (s) => statuses.push(s),
		WebSocketImpl: FakeWS as unknown as typeof WebSocket,
		setTimeoutImpl: ((fn: () => void, ms: number) => {
			delays.push(ms);
			timers.push(fn);
			return 0;
		}) as unknown as typeof setTimeout,
	});
	const last = () => FakeWS.all[FakeWS.all.length - 1]!;
	return { conn, delays, timers, statuses, msgs, last };
}

test("sends hello on open", () => {
	const { last, statuses } = setup();
	expect(statuses).toEqual(["connecting"]);
	last().open();
	expect(last().sent).toEqual([JSON.stringify(HELLO)]);
	expect(statuses).toEqual(["connecting", "open"]);
});

test("sends nothing but hello before welcome", () => {
	const { conn, last, statuses } = setup();
	last().open();
	conn.send({ t: "ping" } as unknown as TClientMsg);
	expect(last().sent).toHaveLength(1);
	last().recv(WELCOME);
	expect(statuses.at(-1)).toBe("ready");
	conn.send({ t: "ping" } as unknown as TClientMsg);
	expect(last().sent).toHaveLength(2);
});

test("passes every welcome to onMessage", () => {
	const { last, msgs } = setup();
	last().open();
	last().recv(WELCOME);
	last().recv(WELCOME);
	expect(msgs).toHaveLength(2);
});

test("reconnects with backoff", () => {
	const { last, delays, timers } = setup();
	for (let i = 0; i < 6; i++) {
		last().open();
		last().drop();
		timers.shift()!();
	}
	expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
});

test("backoff resets on welcome", () => {
	const { last, delays, timers } = setup();
	last().open();
	last().drop();
	timers.shift()!();
	last().open();
	last().drop();
	timers.shift()!();
	last().open();
	last().recv(WELCOME);
	last().drop();
	expect(delays).toEqual([500, 1000, 500]);
});

test("no reconnect after kicked", () => {
	const { last, delays, statuses } = setup();
	last().open();
	last().recv({ t: "kicked", reason: "x" } as TServerMsg);
	last().drop();
	expect(delays).toEqual([]);
	expect(statuses.at(-1)).toBe("closed");
});

test("send is dropped while closed", () => {
	const { conn, last } = setup();
	last().open();
	last().recv(WELCOME);
	last().drop();
	conn.send({ t: "ping" } as unknown as TClientMsg);
	expect(last().sent).toHaveLength(1);
});

test("close stops reconnecting", () => {
	const { conn, last, delays } = setup();
	last().open();
	conn.close();
	expect(delays).toEqual([]);
});

test("close after drop cancels the pending reconnect", () => {
	const { conn, last, timers } = setup();
	last().open();
	last().drop();
	const before = FakeWS.all.length;
	conn.close();
	timers.shift()!();
	expect(FakeWS.all.length).toBe(before);
});
