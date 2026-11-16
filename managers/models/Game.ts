import mongoose from "mongoose";

const GameWorldSchema = new mongoose.Schema({
	guildId: { type: String, required: true, unique: true },
	epoch: { type: Number, required: true },
	plotOwners: { type: [mongoose.SchemaTypes.Mixed], default: [] },
});

const GamePlayerSchema = new mongoose.Schema({
	guildId: { type: String, required: true },
	userId: { type: String, required: true },
	name: String,
	x: Number,
	y: Number,
	facing: String,
	energy: Number,
	lastEnergyAt: Number,
	equipped: String,
	plotId: { type: Number, default: null },
	colour: String,
});
GamePlayerSchema.index({ guildId: 1, userId: 1 }, { unique: true });

const GameTileSchema = new mongoose.Schema({
	guildId: { type: String, required: true },
	x: { type: Number, required: true },
	y: { type: Number, required: true },
	tilled: Boolean,
	cropId: String,
	plantedDay: Number,
	wateredDays: { type: [Number], default: [] },
	clearedDay: Number,
});
GameTileSchema.index({ guildId: 1, x: 1, y: 1 }, { unique: true });

export const GameWorld = mongoose.model("game_world", GameWorldSchema);
export const GamePlayer = mongoose.model("game_player", GamePlayerSchema);
export const GameTile = mongoose.model("game_tile", GameTileSchema);
