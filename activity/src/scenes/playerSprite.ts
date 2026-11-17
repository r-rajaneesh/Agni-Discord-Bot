// One player: body, Farm Pass crown, name label, a local-chat speech bubble and emotes
import Phaser from "phaser";
import type { TEmote } from "@game/data/emotes";
import type { TPlayerView } from "@game/protocol";
import { SCALE, TILE, playerTexture } from "../textures";

const BUBBLE_MS = 4000;
/** How long an emote's icon stays above the player */
export const EMOTE_MS = 3000;
const HALF = TILE / 2;

// Each animation as a tween of the body, which returns to rest afterwards. All end within EMOTE_MS.
const ANIMS: Record<TEmote["anim"], Omit<Phaser.Types.Tweens.TweenBuilderConfig, "targets">> = {
	bounce: { y: -4 * SCALE, duration: 150, yoyo: true, repeat: 3, ease: "Quad.easeOut" },
	jump: { y: -10 * SCALE, duration: 250, yoyo: true, repeat: 1, ease: "Quad.easeOut" },
	spin: { angle: 360, duration: 600, repeat: 1 },
	shake: { x: 2 * SCALE, duration: 60, yoyo: true, repeat: 7 },
	wiggle: { angle: { from: -12, to: 12 }, duration: 200, yoyo: true, repeat: 4 },
	float: { y: -6 * SCALE, duration: 700, yoyo: true, repeat: 0, hold: 400, ease: "Sine.easeInOut" },
	sit: { scaleY: SCALE * 0.75, y: 3 * SCALE, duration: 150, yoyo: true, hold: 2000 },
	lie: { angle: 90, y: 3 * SCALE, duration: 200, yoyo: true, hold: 2200 },
};

export class PlayerSprite extends Phaser.GameObjects.Container {
	private bodyImg: Phaser.GameObjects.Image;
	private crown: Phaser.GameObjects.Image;
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
		this.bodyImg = new Phaser.GameObjects.Image(scene, 0, 0, playerTexture(scene.textures, view.colour, view.facing)).setScale(SCALE);
		// The crown sprite's pixels sit on its bottom rows, so this puts them on top of the head
		this.crown = new Phaser.GameObjects.Image(scene, 0, -HALF - 14 * SCALE + HALF, "crown").setScale(SCALE);
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
		this.add([this.bodyImg, this.crown, this.label]);
		this.layout();
		scene.add.existing(this);
	}

	/** Applies a new view (colour, facing, name, crown). Position is set by the scene. */
	setView(view: TPlayerView): void {
		const old = this.view;
		this.view = view;
		if (view.colour !== old.colour || view.facing !== old.facing)
			this.bodyImg.setTexture(playerTexture(this.scene.textures, view.colour, view.facing));
		if (view.name !== old.name) this.label.setText(view.name);
		if (view.premium !== old.premium || view.name !== old.name) this.layout();
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
		this.anim = this.scene.tweens.add({ targets: this.bodyImg, ...ANIMS[e.anim], onComplete: () => this.rest(), onStop: () => this.rest() });
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
		this.bodyImg.setPosition(0, 0).setAngle(0).setScale(SCALE);
	}

	private layout(): void {
		this.crown.setVisible(this.view.premium);
		this.label.setY(this.view.premium ? -HALF - 9 * SCALE : -HALF);
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
