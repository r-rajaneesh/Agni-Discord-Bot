// One player: body, Farm Pass crown, name label and a local-chat speech bubble
import Phaser from "phaser";
import type { TPlayerView } from "@game/protocol";
import { SCALE, TILE, playerTexture } from "../textures";

const BUBBLE_MS = 4000;
const HALF = TILE / 2;

export class PlayerSprite extends Phaser.GameObjects.Container {
	private bodyImg: Phaser.GameObjects.Image;
	private crown: Phaser.GameObjects.Image;
	private label: Phaser.GameObjects.Text;
	private bubble: Phaser.GameObjects.Text | null = null;
	private bubbleTimer: Phaser.Time.TimerEvent | null = null;

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
		});
	}

	private layout(): void {
		this.crown.setVisible(this.view.premium);
		this.label.setY(this.view.premium ? -HALF - 9 * SCALE : -HALF);
		this.bubble?.setY(this.label.y - this.label.height - 4);
	}

	override destroy(fromScene?: boolean): void {
		this.bubbleTimer?.remove();
		super.destroy(fromScene);
	}
}
