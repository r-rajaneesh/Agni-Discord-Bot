// The game world: chunked ground, players, night and the camera
import Phaser from "phaser";
import { EMOTES } from "@game/data/emotes";
import { clock, darkness } from "@game/engine";
import type { TDir } from "@game/protocol";
import { INTERP_DELAY_MS, InterpBuffer } from "../interp";
import type { ClientState, THints } from "../state";
import { ANIMAL_FRAMES, DRAW_SCALE, TILE } from "../assets/manifest";
import { animalAnim } from "../textures";
import { ChunkRenderer } from "./chunkRenderer";
import { PlayerSprite } from "./playerSprite";

const NIGHT_COLOUR = 0x10143c;
const NIGHT_DEPTH = 1e9;

interface TOther {
	sprite: PlayerSprite;
	buf: InterpBuffer;
}

interface TWild {
	sprite: Phaser.GameObjects.Sprite;
	buf: InterpBuffer;
	kind: string;
	facing: TDir;
	walking: boolean;
	lastMove: number;
}

// Still this long after the last move counts as standing
const STILL_MS = 120;

export class World extends Phaser.Scene {
	private ready = false;
	private chunks!: ChunkRenderer;
	private night!: Phaser.GameObjects.Rectangle;
	private me: PlayerSprite | null = null;
	private others = new Map<string, TOther>();
	private animals = new Map<number, TWild>();

	/** `youAt` says where to draw our own player (the predictor smooths it between ticks) */
	constructor(
		private state: ClientState,
		private youAt: () => { x: number; y: number } | null = () => state.you,
	) {
		super("world");
	}

	create(): void {
		this.chunks = new ChunkRenderer(this, this.state);
		this.night = this.add
			.rectangle(0, 0, this.scale.width, this.scale.height, NIGHT_COLOUR, 1)
			.setOrigin(0, 0)
			.setScrollFactor(0)
			.setDepth(NIGHT_DEPTH)
			.setAlpha(0);
		this.scale.on(Phaser.Scale.Events.RESIZE, (size: Phaser.Structs.Size) => this.night.setSize(size.width, size.height));
		this.cameras.main.setRoundPixels(true);
		this.rebuild();
		this.ready = true;
	}

	/** Reacts to what ClientState.apply changed */
	handle(h: THints): void {
		if (!this.ready) return;
		const now = Date.now();
		if (h.reset) this.rebuild();
		else {
			if (h.redrawChunks) this.chunks.redrawAll(now);
			if (h.redrawTiles) this.chunks.redrawTiles(h.redrawTiles, now);
			for (const id of h.players ?? []) this.syncOther(id);
			for (const id of h.animals ?? []) this.syncAnimal(id);
		}
	}

	/** Speech bubble hook for local chat */
	say(userId: string, text: string): void {
		if (userId === this.state.userId) this.me?.say(text);
		else this.others.get(userId)?.sprite.say(text);
	}

	/** Plays an emote on a player in view */
	emote(userId: string, id: string): void {
		const e = EMOTES[id];
		if (!e) return;
		if (userId === this.state.userId) this.me?.emote(e);
		else this.others.get(userId)?.sprite.emote(e);
	}

	override update(): void {
		const you = this.state.you;
		const at = you && this.youAt();
		const t = performance.now();
		if (you && at && this.me) {
			this.me.setView(you);
			this.me.walkTo(at.x * TILE, at.y * TILE, t);
		}
		const past = t - INTERP_DELAY_MS;
		for (const o of this.others.values()) {
			const p = o.buf.sample(past);
			if (p) o.sprite.walkTo(p.x * TILE, p.y * TILE, t);
		}
		for (const a of this.animals.values()) {
			const p = a.buf.sample(past);
			if (!p) continue;
			if (Math.abs(p.x * TILE - a.sprite.x) > 0.01 || Math.abs(p.y * TILE - a.sprite.y) > 0.01) a.lastMove = t;
			a.sprite.setPosition(p.x * TILE, p.y * TILE).setDepth(p.y);
			this.poseAnimal(a, t - a.lastMove < STILL_MS);
		}
		const inst = this.state.instance;
		if (!inst) return;
		const now = Date.now();
		this.chunks.update(this.cameras.main, now);
		this.night.setAlpha(darkness(clock(inst.epoch, now).minuteOfDay));
	}

	// A new instance: nothing drawn for the old one is kept
	private rebuild(): void {
		this.chunks.clear();
		for (const o of this.others.values()) o.sprite.destroy();
		this.others.clear();
		for (const a of this.animals.values()) a.sprite.destroy();
		this.animals.clear();
		this.me?.destroy();
		this.me = null;
		const you = this.state.you;
		if (you) {
			this.me = new PlayerSprite(this, you, true);
			this.me.place(you.x * TILE, you.y * TILE);
			this.cameras.main.startFollow(this.me, true);
			this.cameras.main.centerOn(this.me.x, this.me.y);
		}
		for (const id of this.state.players.keys()) this.syncOther(id);
		for (const id of this.state.animals.keys()) this.syncAnimal(id);
	}

	private syncOther(id: string): void {
		const view = this.state.players.get(id);
		let o = this.others.get(id);
		if (!view) {
			o?.sprite.destroy();
			this.others.delete(id);
			return;
		}
		if (!o) {
			o = { sprite: new PlayerSprite(this, view, false), buf: new InterpBuffer() };
			o.sprite.place(view.x * TILE, view.y * TILE);
			this.others.set(id, o);
		} else o.sprite.setView(view);
		o.buf.push(performance.now(), view.x, view.y);
	}

	// Animals are drawn 100 ms behind, like other players, and removed when they leave the ents list
	private syncAnimal(id: number): void {
		const view = this.state.animals.get(id);
		let a = this.animals.get(id);
		if (!view) {
			a?.sprite.destroy();
			this.animals.delete(id);
			return;
		}
		// An unknown kind draws as a rabbit
		const kind = ANIMAL_FRAMES[view.kind] ? view.kind : "rabbit";
		if (!a) {
			const sprite = this.add.sprite(view.x * TILE, view.y * TILE, "animals", ANIMAL_FRAMES[kind]![view.facing][0]!.frame).setScale(DRAW_SCALE).setDepth(view.y);
			a = { sprite, buf: new InterpBuffer(), kind, facing: view.facing, walking: false, lastMove: 0 };
			this.animals.set(id, a);
		} else if (a.facing !== view.facing) {
			a.facing = view.facing;
			this.poseAnimal(a, a.walking, true);
		}
		a.buf.push(performance.now(), view.x, view.y);
	}

	// The walk animation for the animal's facing, or its standing frame
	private poseAnimal(a: TWild, walking: boolean, force = false): void {
		if (walking === a.walking && !force) return;
		a.walking = walking;
		if (walking) a.sprite.play(animalAnim(a.kind, a.facing), true);
		else a.sprite.stop().setFrame(ANIMAL_FRAMES[a.kind]![a.facing][0]!.frame);
	}
}
