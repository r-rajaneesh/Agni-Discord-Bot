import mongoose from "mongoose";

const LandSchema = new mongoose.Schema({
	landId: { type: String, required: true, unique: true },
	ownerId: { type: String, required: true },
	slot: { type: Number, required: true, default: 0 },
	seed: { type: Number, required: true },
	epoch: { type: Number, required: true },
	unlocked: { type: [String], default: [] },
	createdAt: { type: Date, default: Date.now },
});
LandSchema.index({ ownerId: 1, slot: 1 }, { unique: true });

const LandTileSchema = new mongoose.Schema({
	landId: { type: String, required: true },
	x: { type: Number, required: true },
	y: { type: Number, required: true },
	tilled: Boolean,
	cropId: String,
	plantedDay: Number,
	wateredDays: { type: [Number], default: [] },
	clearedDay: Number,
});
LandTileSchema.index({ landId: 1, x: 1, y: 1 }, { unique: true });

const PlayerStateSchema = new mongoose.Schema({
	userId: { type: String, required: true, unique: true },
	name: String,
	colour: String,
	energy: Number,
	lastEnergyAt: Number,
	equipped: String,
	/** UTC day of the mining gem counter, and gems found that day (daily cap) */
	gemDay: String,
	gemsToday: Number,
	location: {
		instanceKind: { type: String, enum: ["land", "world"], required: true },
		landId: String,
		lobby: Number,
		x: Number,
		y: Number,
		facing: String,
	},
});

export const Land = mongoose.model("land", LandSchema);
export const LandTile = mongoose.model("land_tile", LandTileSchema);
export const PlayerState = mongoose.model("player_state", PlayerStateSchema);
