// Emotes: 15 free for everyone, the rest unlocked with earned gems or a real-money emote pack.
// `anim` names the animation the client plays on the player sprite.

export interface TEmote {
	id: string;
	name: string;
	icon: string;
	anim: "bounce" | "spin" | "shake" | "jump" | "sit" | "lie" | "wiggle" | "float";
	/** Gem price; null = free */
	gems: number | null;
}

const LIST: TEmote[] = [
	{ id: "wave", name: "Wave", icon: "👋", anim: "wiggle", gems: null },
	{ id: "nod", name: "Nod", icon: "🙂", anim: "bounce", gems: null },
	{ id: "shake_head", name: "Shake head", icon: "🙅", anim: "shake", gems: null },
	{ id: "laugh", name: "Laugh", icon: "😂", anim: "bounce", gems: null },
	{ id: "cry", name: "Cry", icon: "😢", anim: "shake", gems: null },
	{ id: "angry", name: "Angry", icon: "😠", anim: "shake", gems: null },
	{ id: "love", name: "Love", icon: "❤️", anim: "float", gems: null },
	{ id: "thumbs_up", name: "Thumbs up", icon: "👍", anim: "jump", gems: null },
	{ id: "clap", name: "Clap", icon: "👏", anim: "bounce", gems: null },
	{ id: "dance", name: "Dance", icon: "💃", anim: "wiggle", gems: null },
	{ id: "sit", name: "Sit", icon: "🪑", anim: "sit", gems: null },
	{ id: "sleep", name: "Sleep", icon: "💤", anim: "lie", gems: null },
	{ id: "surprised", name: "Surprised", icon: "😮", anim: "jump", gems: null },
	{ id: "thinking", name: "Thinking", icon: "🤔", anim: "float", gems: null },
	{ id: "point", name: "Point", icon: "👉", anim: "wiggle", gems: null },
	{ id: "breakdance", name: "Breakdance", icon: "🕺", anim: "spin", gems: 150 },
	{ id: "moonwalk", name: "Moonwalk", icon: "🌙", anim: "wiggle", gems: 150 },
	{ id: "flex", name: "Flex", icon: "💪", anim: "bounce", gems: 75 },
	{ id: "guitar", name: "Guitar", icon: "🎸", anim: "wiggle", gems: 120 },
	{ id: "fireworks", name: "Fireworks", icon: "🎆", anim: "jump", gems: 200 },
	{ id: "money_rain", name: "Money rain", icon: "💸", anim: "float", gems: 200 },
	{ id: "rain_cloud", name: "Rain cloud", icon: "🌧️", anim: "float", gems: 75 },
	{ id: "royal_bow", name: "Royal bow", icon: "🙇", anim: "sit", gems: 100 },
	{ id: "backflip", name: "Backflip", icon: "🤸", anim: "spin", gems: 150 },
	{ id: "facepalm", name: "Facepalm", icon: "🤦", anim: "shake", gems: 50 },
	{ id: "zombie_walk", name: "Zombie walk", icon: "🧟", anim: "wiggle", gems: 100 },
	{ id: "victory", name: "Victory", icon: "🏆", anim: "jump", gems: 75 },
	{ id: "salute", name: "Salute", icon: "🫡", anim: "bounce", gems: 50 },
	{ id: "chicken_dance", name: "Chicken dance", icon: "🐔", anim: "wiggle", gems: 120 },
	{ id: "spin", name: "Spin", icon: "🌀", anim: "spin", gems: 50 },
];

// No prototype, so ids like "constructor" are simply unknown
export const EMOTES: Record<string, TEmote> = Object.assign(Object.create(null) as Record<string, TEmote>, Object.fromEntries(LIST.map((e) => [e.id, e])));

export const FREE_EMOTES: string[] = LIST.filter((e) => e.gems === null).map((e) => e.id);

/** Free emotes for everyone; premium ones once owned */
export function canUseEmote(id: string, owned: ReadonlySet<string>): boolean {
	const e = EMOTES[id];
	return !!e && (e.gems === null || owned.has(id));
}
