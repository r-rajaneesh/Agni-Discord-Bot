import mongoose from "mongoose";
import * as Economy from "./models/Economy";
import * as Game from "./models/Game";
const UserSchema = new mongoose.Schema({
	id: { type: mongoose.SchemaTypes.String, required: true, unique: true },
	locale: { type: mongoose.SchemaTypes.String, default: "en" },
	// permissions:[{}]
});

const BookmarkSchema = new mongoose.Schema({
	messageID: { type: mongoose.SchemaTypes.String, required: true },
	channelID: { type: mongoose.SchemaTypes.String, required: true },
	guildID: { type: mongoose.SchemaTypes.String, required: true },
	authorID: { type: mongoose.SchemaTypes.String, required: true },
	DM: [
		{
			messageID: { type: mongoose.SchemaTypes.String, required: true },
			userID: { type: mongoose.SchemaTypes.String, required: true },
			channelID: { type: mongoose.SchemaTypes.String, required: true },
		},
	],
	Channel: [
		{
			message: { type: mongoose.SchemaTypes.String, required: true },
			id: { type: mongoose.SchemaTypes.String, required: true },
		},
	],
});

const GuildSchema = new mongoose.Schema({
	id: { type: mongoose.SchemaTypes.String, required: true, unique: true },
	locale: mongoose.SchemaTypes.String,
});

// Key/value store for bot internals (e.g. the registered command hash)
const MetaSchema = new mongoose.Schema({
	key: { type: mongoose.SchemaTypes.String, required: true, unique: true },
	value: mongoose.SchemaTypes.Mixed,
});

const User = mongoose.model("user", UserSchema);
const Bookmark = mongoose.model("bookmark", BookmarkSchema);
const Guild = mongoose.model("guild", GuildSchema);
const Meta = mongoose.model("meta", MetaSchema);

type TUserDoc = mongoose.HydratedDocument<mongoose.InferSchemaType<typeof UserSchema>>;
type TGuildDoc = mongoose.HydratedDocument<mongoose.InferSchemaType<typeof GuildSchema>>;

const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 10_000;

// Small TTL cache so hot paths (every interaction / message) skip Mongo round trips.
class TTLCache<V> {
	private store = new Map<string, { value: V; expires: number }>();
	get(key: string) {
		const hit = this.store.get(key);
		if (!hit) return undefined;
		if (hit.expires < Date.now()) {
			this.store.delete(key);
			return undefined;
		}
		return hit.value;
	}
	set(key: string, value: V) {
		if (this.store.size >= CACHE_MAX) this.store.delete(this.store.keys().next().value as string);
		this.store.set(key, { value, expires: Date.now() + CACHE_TTL });
	}
	delete(key: string) {
		this.store.delete(key);
	}
}

const userCache = new TTLCache<TUserDoc>();
const guildCache = new TTLCache<TGuildDoc>();

async function getUser(id: string) {
	const cached = userCache.get(id);
	if (cached) return cached;
	const user = (await User.findOneAndUpdate(
		{ id },
		{ $setOnInsert: { id } },
		{ upsert: true, new: true },
	)) as TUserDoc;
	userCache.set(id, user);
	return user;
}

async function getGuild(id: string | null | undefined) {
	if (!id) return null;
	const cached = guildCache.get(id);
	if (cached) return cached;
	const guild = (await Guild.findOneAndUpdate(
		{ id },
		{ $setOnInsert: { id } },
		{ upsert: true, new: true },
	)) as TGuildDoc;
	guildCache.set(id, guild);
	return guild;
}

export default { User, Bookmark, Guild, Meta, ...Economy, ...Game, getUser, getGuild, userCache, guildCache };
