import mongoose from "mongoose";
const UserSchema = new mongoose.Schema({
	id: mongoose.SchemaTypes.String,
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
	id: mongoose.SchemaTypes.String,
	locale: mongoose.SchemaTypes.String,
});
const User = mongoose.model("user", UserSchema);
const Bookmark = mongoose.model("bookmark", BookmarkSchema);
const Guild = mongoose.model("guild", GuildSchema);

export default { User, Bookmark, Guild };
