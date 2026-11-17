// One player: shadow, body (tinted shirt plus untinted detail), Farm Pass crown, name label,
// a local-chat speech bubble and emotes
import Phaser from "phaser";
import type { TEmote } from "@game/data/emotes";
import type { TDir, TPlayerView } from "@game/protocol";
import { CHARACTER_DETAIL_FRAMES, CHARACTER_FRAMES, CROWN_FRAME, DRAW_SCALE, SHADOW_FRAME, TILE } from "../assets/manifest";
import { bodyAnim, detailAnim } from "../textures";

const BUBBLE_MS = 4000;
// Still this long after the last move counts as standing
const STILL_MS = 120;
// Screen pixels per pixel of the old 16 px sprites, which the emote motions were tuned in
const PX = 3;
/** How long an emote's icon stays above the player */
export const EMOTE_MS = 3000;
const HALF = TILE / 2;

// Each animation as a tween of the body, which returns to rest afterwards. All end within EMOTE_MS.
const ANIMS: Record<TEmote["anim"], Omit<Phaser.Types.Tweens.TweenBuilderConfig, "targets">> = {
	bounce: { y: -4 * PX, duration: 150, yoyo: true, repeat: 3, ease: "Quad.easeOut" },
	jump: { y: -10 * PX, duration: 250, yoyo: true, repeat: 1, ease: "Quad.easeOut" },
	spin: { angle: 360, duration: 600, repeat: 1 },
	shake: { x: 2 * PX, duration: 60, yoyo: true, repeat: 7 },
	wiggle: { angle: { from: -12, to: 12 }, duration: 200, yoyo: true, repeat: 4 },
	float: { y: -6 * PX, duration: 700, yoyo: true, repeat: 0, hold: 400, ease: "Sine.easeInOut" },
	sit: { scaleY: 0.75, y: 3 * PX, duration: 150, yoyo: true, hold: 2000 },
	lie: { angle: 90, y: 3 * PX, duration: 200, yoyo: true, hold: 2200 },
};

/** The player's colour as a tint; anything unreadable leaves the shirt white */
export function tintOf(colour: string): number {
	const m = /^#([0-9a-f]{6})$/i.exec(colour);
	return m ? parseInt(m[1]!, 16) : 0xffffff;
}

export class PlayerSprite extends Phaser.GameObjects.Container {
	// Emotes move the figure; the shadow stays on the ground
	private figure: Phaser.GameObjects.Container;
	private shirt: Phaser.GameObjects.Sprite;
	private detail: Phaser.GameObjects.Sprite;
	private crown: Phaser.GameObjects.Image;
	private walking = false;
	private lastMove = 0;
	private label: Phaser.GameObjects.Text;
	private bubble: Phaser.GameObjects.Text | null = null;
	private bubbleTimer: Phaser.Time.TimerEvent | null = null;
	private icon: Phaser.GameObjects.Text | null = null;
	private iconTimer: Phaser.Time.TimerEvent | null = null;
	private anim: Phaser.Tweens.Tween | null = null;

	constructor(
		scene: Phaser.Scene,
		private view: TPlayerView,
		isYou: boolean,
	) {
		super(scene, 0, 0);
		const stand = (f: typeof CHARACTER_FRAMES, d: TDir) => f[d][0]!;
		this.shirt = new Phaser.GameObjects.Sprite(scene, 0, 0, "characters", stand(CHARACTER_FRAMES, view.facing).frame).setScale(DRAW_SCALE).setTint(tintOf(view.colour));
		this.detail = new Phaser.GameObjects.Sprite(scene, 0, 0, "characters", stand(CHARACTER_DETAIL_FRAMES, view.facing).frame).setScale(DRAW_SCALE);
		this.figure = new Phaser.GameObjects.Container(scene, 0, 0, [this.shirt, this.detail]);
		const shadow = new Phaser.GameObjects.Image(scene, 0, HALF - 4, SHADOW_FRAME.atlas, SHADOW_FRAME.frame).setScale(DRAW_SCALE);
		// Sits on the head
		this.crown = new Phaser.GameObjects.Image(scene, 0, -17, CROWN_FRAME.atlas, CROWN_FRAME.frame).setScale(DRAW_SCALE).setOrigin(0.5, 1);
		this.label = new Phaser.GameObjects.Text(scene, 0, 0, view.name, {
			fontFamily: "sans-serif",
			fontSize: "14px",
			fontStyle: "bold",
			color: isYou ? "#f1c40f" : "#ffffff",
			backgroundColor: "rgba(0,0,0,0.6)",
			padding: { x: 5, y: 2 },
		})
			.setOrigin(0.5, 1)
			.setResolution(2);
		this.add([shadow, this.figure, this.crown, this.label]);
		this.layout();
		scene.add.existing(this);
	}

	/** Applies a new view (colour, facing, name, crown). Position is set by the scene. */
	setView(view: TPlayerView): void {
		const old = this.view;
		this.view = view;
		if (view.colour !== old.colour) this.shirt.setTint(tintOf(view.colour));
		if (view.facing !== old.facing) this.pose();
		if (view.name !== old.name) this.label.setText(view.name);
		if (view.premium !== old.premium || view.name !== old.name) this.layout();
	}

	/** Puts the player somewhere without walking there */
	place(x: number, y: number): void {
		this.setPosition(x, y).setDepth(y / TILE);
	}

	/** Moves the player; walking animates until it has been still for a moment */
	walkTo(x: number, y: number, now: number): void {
		if (Math.abs(x - this.x) > 0.01 || Math.abs(y - this.y) > 0.01) this.lastMove = now;
		this.place(x, y);
		const walking = now - this.lastMove < STILL_MS;
		if (walking !== this.walking) {
			this.walking = walking;
			this.pose();
		}
	}

	// The walk animation for the facing, or the standing frame
	private pose(): void {
		const d = this.view.facing;
		if (this.walking) {
			this.shirt.play(bodyAnim(d), true);
			this.detail.play(detailAnim(d), true);
			// Both layers keep the same step
			this.detail.anims.setProgress(this.shirt.anims.getProgress());
		} else {
			this.shirt.stop().setFrame(CHARACTER_FRAMES[d][0]!.frame);
			this.detail.stop().setFrame(CHARACTER_DETAIL_FRAMES[d][0]!.frame);
		}
	}

	/** Shows a local-chat message above the player for 4 s */
	say(text: string): void {
		this.bubbleTimer?.remove();
		this.bubble?.destroy();
		this.bubble = new Phaser.GameObjects.Text(this.scene, 0, 0, text, {
			fontFamily: "sans-serif",
			fontSize: "13px",
			color: "#1e1f22",
			backgroundColor: "#ffffff",
			padding: { x: 6, y: 4 },
			wordWrap: { width: 200, useAdvancedWrap: true },
			align: "center",
		})
			.setOrigin(0.5, 1)
			.setResolution(2);
		this.add(this.bubble);
		this.layout();
		this.bubbleTimer = this.scene.time.delayedCall(BUBBLE_MS, () => {
			this.bubble?.destroy();
			this.bubble = null;
			this.bubbleTimer = null;
			this.layout();
		});
	}

	/** Plays an emote's animation and shows its icon above the player for EMOTE_MS */
	emote(e: TEmote): void {
		this.anim?.stop();
		this.rest();
		this.anim = this.scene.tweens.add({ targets: this.figure, ...ANIMS[e.anim], onComplete: () => this.rest(), onStop: () => this.rest() });
		this.iconTimer?.remove();
		this.icon?.destroy();
		this.icon = new Phaser.GameObjects.Text(this.scene, 0, 0, e.icon, { fontFamily: "sans-serif", fontSize: "24px" }).setOrigin(0.5, 1).setResolution(2);
		this.add(this.icon);
		this.layout();
		this.iconTimer = this.scene.time.delayedCall(EMOTE_MS, () => {
			this.icon?.destroy();
			this.icon = null;
			this.iconTimer = null;
			this.layout();
		});
	}

	// The body back at rest
	private rest(): void {
		this.figure.setPosition(0, 0).setAngle(0).setScale(1);
	}

	private layout(): void {
		this.crown.setVisible(this.view.premium);
		this.label.setY(this.view.premium ? -HALF - 10 : -HALF);
		const top = this.label.y - this.label.height - 4;
		this.bubble?.setY(top);
		this.icon?.setY(this.bubble ? top - this.bubble.height - 2 : top);
	}

	override destroy(fromScene?: boolean): void {
		this.anim?.stop();
		this.iconTimer?.remove();
		this.bubbleTimer?.remove();
		super.destroy(fromScene);
	}
}
