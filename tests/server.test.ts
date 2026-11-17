import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clientKey, startServer, type TServerDeps } from "../server";

const dir = mkdtempSync(join(tmpdir(), "static-"));
writeFileSync(join(dir, "index.html"), "<html>spa</html>");
writeFileSync(join(dir, "app.js"), "console.log(1)");

const calls = { webhook: [] as [string, string | undefined][], ws: [] as string[], exchanged: 0 };
let authEnabled = true;
const noop = () => {};
const deps: TServerDeps = {
	auth: {
		exchangeCode: async (code) => {
			calls.exchanged++;
			return code === "good" ? { access_token: "tok" } : null;
		},
	},
	get authEnabled() {
		return authEnabled;
	},
	razorpayWebhook: async (raw, sig) => {
		calls.webhook.push([raw, sig]);
		if (raw === "boom") throw new Error("x");
		return 200;
	},
	isReady: () => true,
	ws: {
		open: (ws) => calls.ws.push(`open:${ws.data.connId.length > 0}`),
		message: (_ws, m) => calls.ws.push(`message:${m}`),
		close: () => calls.ws.push("close"),
	},
	staticDir: dir,
	log: { info: noop, error: noop, warn: noop },
};

let server: ReturnType<typeof startServer>;
let base: string;
beforeAll(() => {
	server = startServer(deps, 0);
	base = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

const post = (path: string, body: string, headers: Record<string, string> = {}) =>
	fetch(base + path, { method: "POST", body, headers });
// Raw request so the client does not normalise the path
async function rawGet(path: string): Promise<string> {
	const sock = await Bun.connect({
		hostname: "localhost",
		port: server.port as number,
		socket: { data(_s, d) { out += d.toString(); }, close() {}, error() {} },
	});
	let out = "";
	sock.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
	await Bun.sleep(200);
	sock.end();
	return out;
}

describe("server", () => {
	test("health", async () => {
		const res = await fetch(`${base}/health`);
		expect(await res.json()).toEqual({ ok: true, discord: true });
	});

	test("paid page", async () => {
		const res = await fetch(`${base}/paid`);
		expect(await res.text()).toContain("Payment received ✅");
	});

	test("token ok", async () => {
		const res = await post("/api/token", JSON.stringify({ code: "good" }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ access_token: "tok" });
	});

	test("token 400 on missing code", async () => {
		expect((await post("/api/token", "{}")).status).toBe(400);
		expect((await post("/api/token", "not json")).status).toBe(400);
	});

	test("token 400 when exchange returns null", async () => {
		expect((await post("/api/token", JSON.stringify({ code: "bad" }))).status).toBe(400);
	});

	test("token 503 without calling Discord when auth not configured", async () => {
		authEnabled = false;
		const before = calls.exchanged;
		const res = await post("/api/token", JSON.stringify({ code: "good" }));
		authEnabled = true;
		expect(res.status).toBe(503);
		expect(calls.exchanged).toBe(before);
	});

	test("webhook passes raw body and signature through", async () => {
		const body = '{"a":  1,"b":"é"}';
		const res = await post("/webhooks/razorpay", body, { "x-razorpay-signature": "sig123" });
		expect(res.status).toBe(200);
		expect(calls.webhook.at(-1)).toEqual([body, "sig123"]);
	});

	test("webhook 500 when handler throws", async () => {
		expect((await post("/webhooks/razorpay", "boom")).status).toBe(500);
	});

	test("webhook 413 over 100 KB, with headers", async () => {
		const res = await post("/webhooks/razorpay", "x".repeat(100 * 1024 + 1));
		expect(res.status).toBe(413);
		expect(res.headers.get("content-security-policy")).toContain("frame-ancestors");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
	});

	test("static serves file and index for unknown path", async () => {
		expect(await (await fetch(`${base}/app.js`)).text()).toBe("console.log(1)");
		expect(await (await fetch(`${base}/some/route`)).text()).toBe("<html>spa</html>");
		expect(await (await fetch(`${base}/`)).text()).toBe("<html>spa</html>");
	});

	test("blocks path traversal", async () => {
		expect((await rawGet("/../package.json")).startsWith("HTTP/1.1 404")).toBe(true);
		expect((await rawGet("/%2e%2e/package.json")).startsWith("HTTP/1.1 404")).toBe(true);
		expect((await rawGet("/%2e%2e%2fpackage.json")).startsWith("HTTP/1.1 404")).toBe(true);
		expect((await rawGet("/%00")).startsWith("HTTP/1.1 404")).toBe(true);
		expect((await rawGet("/%zz")).startsWith("HTTP/1.1 404")).toBe(true);
	});

	test("404 when static dir is missing", async () => {
		const s = startServer({ ...deps, staticDir: join(dir, "nope") }, 0);
		const res = await fetch(`http://localhost:${s.port}/anything`);
		s.stop(true);
		expect(res.status).toBe(404);
		expect(res.headers.get("content-security-policy")).toContain("frame-ancestors");
	});

	test("every response has frame-ancestors CSP", async () => {
		for (const path of ["/health", "/paid", "/app.js", "/x/y", "/ws"]) {
			const res = await fetch(base + path);
			expect(res.headers.get("content-security-policy")).toBe(
				"frame-ancestors https://discord.com https://*.discord.com https://*.discordsays.com",
			);
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		}
	});

	test("per-IP limits answer 429 on /ws upgrades and /api/token", async () => {
		const s = startServer({ ...deps, limits: { upgrades: 2, tokens: 2 }, trustedIpHeader: "cf-connecting-ip" }, 0);
		const at = `http://localhost:${s.port}`;
		const ip = { "cf-connecting-ip": "203.0.113.7" };
		const token = (headers: Record<string, string> = ip) => fetch(`${at}/api/token`, { method: "POST", body: JSON.stringify({ code: "good" }), headers });
		const before = calls.exchanged;
		expect((await token()).status).toBe(200);
		expect((await token()).status).toBe(200);
		const refused = await token();
		expect(refused.status).toBe(429);
		expect(refused.headers.get("content-security-policy")).toContain("frame-ancestors");
		expect(calls.exchanged).toBe(before + 2);
		// Another client behind the same proxy has its own bucket
		expect((await token({ "cf-connecting-ip": "198.51.100.9" })).status).toBe(200);
		// Not upgrade requests, but they count against the same budget
		const ws = () => fetch(`${at}/ws`, { headers: ip });
		expect((await ws()).status).toBe(426);
		expect((await ws()).status).toBe(426);
		expect((await ws()).status).toBe(429);
		s.stop(true);
	});

	test("without a trusted header, loopback requests are not limited", async () => {
		const s = startServer({ ...deps, limits: { upgrades: 1, tokens: 1 }, trustedIpHeader: "" }, 0);
		const at = `http://localhost:${s.port}`;
		for (let i = 0; i < 3; i++) {
			expect((await fetch(`${at}/api/token`, { method: "POST", body: JSON.stringify({ code: "good" }) })).status).toBe(200);
			expect((await fetch(`${at}/ws`)).status).toBe(426);
		}
		s.stop(true);
	});

	test("clientKey picks the limiter key", () => {
		const req = (headers: Record<string, string> = {}) => new Request("http://x/", { headers });
		// Trusted header: its value; x-forwarded-for: the first address
		expect(clientKey(req({ "cf-connecting-ip": "203.0.113.7" }), "127.0.0.1", "cf-connecting-ip")).toBe("203.0.113.7");
		expect(clientKey(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 127.0.0.1" }), "127.0.0.1", "x-forwarded-for")).toBe("203.0.113.7");
		// Header configured but absent: the request IP
		expect(clientKey(req(), "198.51.100.9", "cf-connecting-ip")).toBe("198.51.100.9");
		// No header: loopback and private addresses are not limited, public ones are
		for (const ip of ["127.0.0.1", "127.9.9.9", "::1", "::ffff:127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1"])
			expect(clientKey(req(), ip, "")).toBeNull();
		for (const ip of ["203.0.113.7", "172.32.0.1", "8.8.8.8", "2001:db8::1"]) expect(clientKey(req(), ip, "")).toBe(ip);
		// A header sent by a client is ignored when none is trusted
		expect(clientKey(req({ "x-forwarded-for": "1.2.3.4" }), "203.0.113.7", "")).toBe("203.0.113.7");
	});

	test("ws upgrade calls open/message/close", async () => {
		const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
		await new Promise((r) => (ws.onopen = r));
		ws.send("hi");
		await Bun.sleep(100);
		ws.close();
		await Bun.sleep(100);
		expect(calls.ws).toEqual(["open:true", "message:hi", "close"]);
	});
});
