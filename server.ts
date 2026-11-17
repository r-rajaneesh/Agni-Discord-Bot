import type { Server, ServerWebSocket } from "bun";
import { resolve, sep } from "node:path";
import { MAX_MSG_BYTES } from "./game/protocol";
import type ActivityAuth from "./managers/ActivityAuth";
import RateLimiter from "./managers/RateLimiter";

export type TSocketData = { connId: string; userId?: string };

export interface TServerDeps {
	auth: Pick<ActivityAuth, "exchangeCode">;
	/** False when Discord credentials are missing: /api/token answers 503. Defaults to true. */
	authEnabled?: boolean;
	razorpayWebhook: (raw: string, sig: string | undefined) => Promise<number>;
	isReady: () => boolean;
	ws: {
		open(ws: ServerWebSocket<TSocketData>): void;
		message(ws: ServerWebSocket<TSocketData>, msg: string | Buffer): void;
		close(ws: ServerWebSocket<TSocketData>): void;
	};
	staticDir: string;
	/** Per-IP requests per minute; defaults to 20 websocket upgrades and 10 token exchanges */
	limits?: { upgrades?: number; tokens?: number };
	log: { info(...a: unknown[]): void; error(...a: unknown[]): void; warn(...a: unknown[]): void };
}

const WEBHOOK_MAX_BYTES = 100 * 1024;
const TOKEN_MAX_BYTES = 4096;
const UPGRADES_PER_MIN = 20;
const TOKENS_PER_MIN = 10;

const PAID_HTML =
	"<!doctype html><meta charset=utf-8><title>Payment received</title><body style='font-family:sans-serif;text-align:center;padding:4rem'><h1>Payment received ✅</h1><p>Your items arrive in Discord within a minute. You can close this tab.</p>";

// Lets Discord frame the page
const SECURITY_HEADERS = {
	"Content-Security-Policy": "frame-ancestors https://discord.com https://*.discord.com https://*.discordsays.com",
	"X-Content-Type-Options": "nosniff",
};

function withHeaders(res: Response): Response {
	for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
	return res;
}

function json(body: unknown, status = 200): Response {
	return Response.json(body, { status });
}

// Reads a body up to max bytes; null when larger
async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
	if (Number(req.headers.get("content-length") ?? 0) > max) return null;
	if (!req.body) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for await (const chunk of req.body as unknown as AsyncIterable<Uint8Array>) {
		total += chunk.length;
		if (total > max) return null;
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

async function serveStatic(root: string, pathname: string): Promise<Response> {
	let rel: string;
	try {
		rel = decodeURIComponent(pathname);
	} catch {
		return new Response("Not found", { status: 404 });
	}
	if (rel.includes("\0")) return new Response("Not found", { status: 404 });
	const base = resolve(root);
	const target = resolve(base, `.${rel}`);
	if (target !== base && !target.startsWith(base + sep)) return new Response("Not found", { status: 404 });

	try {
		const file = Bun.file(target);
		if (rel !== "/" && (await file.exists())) return new Response(file);
		// SPA fallback, but never for something that looks like a file request
		if (/\.[a-z0-9]+$/i.test(rel)) return new Response("Not found", { status: 404 });
		const index = Bun.file(resolve(base, "index.html"));
		if (await index.exists()) return new Response(index);
	} catch {
		// fall through
	}
	return new Response("Not found", { status: 404 });
}

export function startServer(deps: TServerDeps, port: number): Server {
	// Each failed hello or code exchange costs a Discord API call; spam from one address must not get the bot's IP banned
	const upgrades = new RateLimiter({ limit: deps.limits?.upgrades ?? UPGRADES_PER_MIN, windowMs: 60_000 });
	const tokens = new RateLimiter({ limit: deps.limits?.tokens ?? TOKENS_PER_MIN, windowMs: 60_000 });
	const ipOf = (req: Request, server: Server) => server.requestIP(req)?.address ?? "unknown";
	const tooMany = () => new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });

	async function handle(req: Request, server: Server): Promise<Response | undefined> {
		const url = new URL(req.url);
		const { pathname } = url;

		if (pathname === "/health" && req.method === "GET") return json({ ok: true, discord: deps.isReady() });

		// Razorpay redirects buyers here after paying; the grant itself happens in the webhook
		if (pathname === "/paid" && req.method === "GET") {
			return new Response(PAID_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
		}

		// Raw body: the signature is computed over the exact bytes Razorpay sent
		if (pathname === "/webhooks/razorpay" && req.method === "POST") {
			const raw = await readCapped(req, WEBHOOK_MAX_BYTES);
			if (!raw) return new Response("Payload too large", { status: 413 });
			try {
				const status = await deps.razorpayWebhook(
					Buffer.from(raw).toString("utf8"),
					req.headers.get("x-razorpay-signature") ?? undefined,
				);
				return new Response(null, { status });
			} catch (error) {
				deps.log.error("[PAYMENT] webhook error", error);
				// 5xx makes Razorpay retry; grants are idempotent so retries are safe
				return new Response(null, { status: 500 });
			}
		}

		if (pathname === "/api/token" && req.method === "POST") {
			if (deps.authEnabled === false) return json({ error: "activity auth not configured" }, 503);
			if (!tokens.take(ipOf(req, server))) return tooMany();
			const raw = await readCapped(req, TOKEN_MAX_BYTES);
			if (!raw) return json({ error: "payload too large" }, 413);
			let code: unknown;
			try {
				code = (JSON.parse(Buffer.from(raw).toString("utf8")) as { code?: unknown })?.code;
			} catch {
				return json({ error: "invalid json" }, 400);
			}
			if (typeof code !== "string" || !code) return json({ error: "missing code" }, 400);
			const token = await deps.auth.exchangeCode(code);
			if (!token) return json({ error: "code exchange failed" }, 400);
			return json({ access_token: token.access_token });
		}

		if (pathname === "/ws") {
			if (!upgrades.take(ipOf(req, server))) return tooMany();
			const ok = server.upgrade(req, { data: { connId: crypto.randomUUID() } });
			return ok ? undefined : new Response("Upgrade required", { status: 426 });
		}

		if (req.method !== "GET" && req.method !== "HEAD") return new Response("Not found", { status: 404 });
		return serveStatic(deps.staticDir, pathname);
	}

	const server = Bun.serve<TSocketData, never>({
		port,
		async fetch(req, srv) {
			try {
				const res = await handle(req, srv);
				return res ? withHeaders(res) : res;
			} catch (error) {
				deps.log.error("[HTTP] unhandled error", error);
				return withHeaders(new Response("Internal error", { status: 500 }));
			}
		},
		websocket: {
			maxPayloadLength: MAX_MSG_BYTES,
			open: (ws) => deps.ws.open(ws),
			message: (ws, msg) => deps.ws.message(ws, msg),
			close: (ws) => deps.ws.close(ws),
		},
	});
	deps.log.info(`HTTP server listening on :${server.port}`);
	return server;
}
