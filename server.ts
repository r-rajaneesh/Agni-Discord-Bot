import express from "express";
import helmet from "helmet";
import type ClientManager from "./managers/ClientManager";

/** Public HTTP endpoint for payment webhooks. Needs HTTPS in front (reverse proxy or Cloudflare Tunnel). */
export function startServer(client: ClientManager) {
	const app = express();
	app.disable("x-powered-by");
	app.use(helmet());

	app.get("/health", (_req, res) => {
		res.json({ ok: true, discord: client.isReady() });
	});

	// Razorpay redirects buyers here after paying; the grant itself happens in the webhook
	app.get("/paid", (_req, res) => {
		res.type("html").send(
			"<!doctype html><meta charset=utf-8><title>Payment received</title><body style='font-family:sans-serif;text-align:center;padding:4rem'><h1>Payment received ✅</h1><p>Your items arrive in Discord within a minute. You can close this tab.</p>",
		);
	});

	// Raw body: the signature is computed over the exact bytes Razorpay sent
	app.post("/webhooks/razorpay", express.raw({ type: "application/json", limit: "100kb" }), async (req, res) => {
		try {
			const status = await client.payments.handleRazorpayWebhook(
				(req.body as Buffer).toString("utf8"),
				req.header("x-razorpay-signature"),
			);
			res.sendStatus(status);
		} catch (error) {
			client.log.error("[PAYMENT] webhook error", error);
			// 5xx makes Razorpay retry; grants are idempotent so retries are safe
			res.sendStatus(500);
		}
	});

	const port = Number(process.env.PORT ?? 3000);
	const server = app.listen(port, () => client.log.info(`Webhook server listening on :${port}`));
	return server;
}
