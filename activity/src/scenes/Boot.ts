// Loads the art atlases behind a progress bar, makes the walk animations, then starts the world
import Phaser from "phaser";
import { createAnims, loadAtlases } from "../textures";

export class Boot extends Phaser.Scene {
	constructor() {
		super("boot");
	}

	preload(): void {
		const { width, height } = this.scale;
		const w = Math.min(320, width - 64);
		const x = (width - w) / 2;
		const y = height / 2;
		this.add.rectangle(x, y, w, 12, 0x2a2f3a).setOrigin(0, 0.5);
		const bar = this.add.rectangle(x, y, 1, 12, 0xf2c14e).setOrigin(0, 0.5);
		this.add.text(width / 2, y - 24, "Loading Agni Valley…", { fontFamily: "sans-serif", fontSize: "16px", color: "#e9e2cf" }).setOrigin(0.5, 1).setResolution(2);
		this.load.on(Phaser.Loader.Events.PROGRESS, (p: number) => bar.setSize(Math.max(1, w * p), 12));
		loadAtlases(this.load);
	}

	create(): void {
		createAnims(this.anims);
		this.scene.start("world");
	}
}
