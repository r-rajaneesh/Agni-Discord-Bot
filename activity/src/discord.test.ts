import { expect, test } from "bun:test";
import { setupDiscord, type TDiscordSdkLike } from "./discord";

test("setupDiscord calls authorize, token, authenticate in order", async () => {
	const calls: string[] = [];
	let authorizeArgs: any;
	const fake = {
		instanceId: "inst-1",
		guildId: "g1",
		channelId: "c1",
		ready: async () => void calls.push("ready"),
		commands: {
			authorize: async (a: unknown) => {
				calls.push("authorize");
				authorizeArgs = a;
				return { code: "abc" };
			},
			authenticate: async (a: { access_token: string }) => {
				calls.push(`authenticate:${a.access_token}`);
				return {};
			},
		},
	} as unknown as TDiscordSdkLike;
	const fakeFetch = (async (url: string, init: RequestInit) => {
		calls.push(`fetch:${url}:${init.body}`);
		return new Response(JSON.stringify({ access_token: "tok" }));
	}) as unknown as typeof fetch;

	const s = await setupDiscord("cid", fakeFetch, () => fake);
	expect(calls).toEqual(["ready", "authorize", 'fetch:/api/token:{"code":"abc"}', "authenticate:tok"]);
	expect(authorizeArgs.scope).toEqual(["identify", "guilds"]);
	expect(authorizeArgs.client_id).toBe("cid");
	expect(s).toMatchObject({ accessToken: "tok", instanceId: "inst-1", guildId: "g1", channelId: "c1" });
});

test("setupDiscord throws when token exchange fails", async () => {
	const fake = {
		ready: async () => {},
		commands: { authorize: async () => ({ code: "x" }), authenticate: async () => ({}) },
	} as unknown as TDiscordSdkLike;
	const bad = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
	await expect(setupDiscord("cid", bad, () => fake)).rejects.toThrow("500");
});
