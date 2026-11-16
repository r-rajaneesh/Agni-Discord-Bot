import { describe, expect, test } from "bun:test";
import ActivityAuth from "../managers/ActivityAuth.ts";

type TCall = { url: string; init?: RequestInit };

function setup(responses: Array<{ status: number; body?: unknown } | Error>) {
	const calls: TCall[] = [];
	let time = 1_000_000;
	const fakeFetch = (async (url: string, init?: RequestInit) => {
		calls.push({ url, init });
		const next = responses.shift();
		if (!next) throw new Error("no response queued");
		if (next instanceof Error) throw next;
		return new Response(JSON.stringify(next.body ?? {}), { status: next.status });
	}) as unknown as typeof fetch;
	const auth = new ActivityAuth({ clientId: "cid", clientSecret: "sec", fetch: fakeFetch, now: () => time });
	return { auth, calls, advance: (ms: number) => (time += ms) };
}

console.warn = () => {};

describe("ActivityAuth", () => {
	test("exchange posts form-encoded body", async () => {
		const { auth, calls } = setup([{ status: 200, body: { access_token: "abc" } }]);
		const res = await auth.exchangeCode("thecode");
		expect(res).toEqual({ access_token: "abc" });
		expect(calls[0]!.url).toBe("https://discord.com/api/oauth2/token");
		expect(calls[0]!.init?.method).toBe("POST");
		expect((calls[0]!.init?.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
		const body = new URLSearchParams(String(calls[0]!.init?.body));
		expect(body.get("client_id")).toBe("cid");
		expect(body.get("client_secret")).toBe("sec");
		expect(body.get("grant_type")).toBe("authorization_code");
		expect(body.get("code")).toBe("thecode");
	});

	test("exchange returns null on 400", async () => {
		const { auth } = setup([{ status: 400 }]);
		expect(await auth.exchangeCode("bad")).toBeNull();
	});

	test("exchange returns null when fetch throws", async () => {
		const { auth } = setup([new Error("net")]);
		expect(await auth.exchangeCode("x")).toBeNull();
	});

	test("verify caches for 5 minutes", async () => {
		const { auth, calls, advance } = setup([
			{ status: 200, body: { id: "1", username: "u", global_name: "Global" } },
			{ status: 200, body: { id: "1", username: "u", global_name: null } },
		]);
		expect(await auth.verify("tok")).toEqual({ id: "1", name: "Global" });
		advance(60_000);
		await auth.verify("tok");
		expect(calls.length).toBe(1);
		advance(301_000);
		expect(await auth.verify("tok")).toEqual({ id: "1", name: "u" });
		expect(calls.length).toBe(2);
		expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
	});

	test("verify returns null on 401 and does not cache it", async () => {
		const { auth, calls } = setup([{ status: 401 }, { status: 200, body: { id: "1", username: "u" } }]);
		expect(await auth.verify("tok")).toBeNull();
		expect(await auth.verify("tok")).toEqual({ id: "1", name: "u" });
		expect(calls.length).toBe(2);
	});

	test("verify returns null on network error and does not cache it", async () => {
		const { auth, calls } = setup([new Error("net"), { status: 200, body: { id: "1", username: "u" } }]);
		expect(await auth.verify("tok")).toBeNull();
		expect((await auth.verify("tok"))?.id).toBe("1");
		expect(calls.length).toBe(2);
	});

	test("guild returns the name when member, null otherwise, and caches the list", async () => {
		const { auth, calls } = setup([{ status: 200, body: [{ id: "g1", name: "One" }, { id: "g2", name: "Two" }] }]);
		expect(await auth.guild("tok", "g2")).toEqual({ id: "g2", name: "Two" });
		expect(await auth.guild("tok", "g9")).toBeNull();
		expect(calls.length).toBe(1);
		expect(calls[0]!.url).toBe("https://discord.com/api/v10/users/@me/guilds");
	});

	test("guild returns null on failure and does not cache it", async () => {
		const { auth, calls } = setup([{ status: 401 }, new Error("net"), { status: 200, body: [{ id: "g1", name: "One" }] }]);
		expect(await auth.guild("tok", "g1")).toBeNull();
		expect(await auth.guild("tok", "g1")).toBeNull();
		expect(await auth.guild("tok", "g1")).toEqual({ id: "g1", name: "One" });
		expect(calls.length).toBe(3);
	});

	test("cache stays bounded", async () => {
		const queue = Array.from({ length: 10_050 }, (_, i) => ({ status: 200, body: { id: String(i), username: "u" } }));
		const { auth } = setup(queue);
		for (let i = 0; i < 10_050; i++) await auth.verify(`t${i}`);
		expect(auth.cacheSize).toBeLessThanOrEqual(10_000);
	});
});
