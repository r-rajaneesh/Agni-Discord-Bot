import { DiscordSDK } from "@discord/embedded-app-sdk";

export interface TDiscordSession {
	accessToken: string;
	instanceId: string;
	guildId: string | null;
	channelId: string | null;
	sdk: DiscordSDK;
}

// Just what setupDiscord uses, so tests can fake it
export type TDiscordSdkLike = Pick<DiscordSDK, "ready" | "commands" | "instanceId" | "guildId" | "channelId">;

export async function setupDiscord(
	clientId: string,
	fetchFn: typeof fetch = fetch,
	sdkFactory: (clientId: string) => TDiscordSdkLike = (id) => new DiscordSDK(id),
): Promise<TDiscordSession> {
	const sdk = sdkFactory(clientId);
	await sdk.ready();
	const { code } = await sdk.commands.authorize({
		client_id: clientId,
		response_type: "code",
		state: "",
		prompt: "none",
		scope: ["identify", "guilds"],
	});
	const res = await fetchFn("/api/token", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ code }),
	});
	if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);
	const body = (await res.json()) as { access_token?: unknown };
	const access_token = body.access_token;
	if (typeof access_token !== "string" || access_token === "") throw new Error("Token exchange returned no access_token");
	await sdk.commands.authenticate({ access_token });
	return { accessToken: access_token, instanceId: sdk.instanceId, guildId: sdk.guildId, channelId: sdk.channelId, sdk: sdk as DiscordSDK };
}
