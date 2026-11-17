// Keyboard and touch input. Movement is read every frame with dir(); actions fire as callbacks.
type TAxis = -1 | 0 | 1;
export interface TDirInput {
	dx: TAxis;
	dy: TAxis;
}

export interface TInputActions {
	use(): void;
	inventory(): void;
	/** Hotbar slot, 0-based */
	slot(i: number): void;
	/** Esc */
	close(): void;
	lobbies(): void;
	/** Enter: focus the chat box */
	chat(): void;
	/** T: the emote wheel */
	emotes(): void;
}

const UP = new Set(["ArrowUp", "KeyW"]);
const DOWN = new Set(["ArrowDown", "KeyS"]);
const LEFT = new Set(["ArrowLeft", "KeyA"]);
const RIGHT = new Set(["ArrowRight", "KeyD"]);
const MOVE = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT]);

const has = (held: Set<string>, keys: Set<string>) => [...keys].some((k) => held.has(k));
const sign = (n: number): TAxis => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** Direction from the held key codes; opposite keys cancel */
export function keyDir(held: Set<string>): TDirInput {
	return {
		dx: sign(Number(has(held, RIGHT)) - Number(has(held, LEFT))),
		dy: sign(Number(has(held, DOWN)) - Number(has(held, UP))),
	};
}

/** The stick offset (screen pixels, y down) snapped to one of 8 directions */
export function stickDir(x: number, y: number, deadZone: number): TDirInput {
	if (Math.hypot(x, y) < deadZone) return { dx: 0, dy: 0 };
	const a = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4);
	return { dx: sign(Math.round(Math.cos(a))), dy: sign(Math.round(Math.sin(a))) };
}

/** True while a text field has focus: game keys are left alone then */
export function isTyping(): boolean {
	const a = document.activeElement;
	return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || (a instanceof HTMLElement && a.isContentEditable);
}

const STICK_RADIUS = 48;
const DEAD_ZONE = 12;

export class Input {
	private held = new Set<string>();
	private stick: TDirInput = { dx: 0, dy: 0 };
	private off: (() => void)[] = [];

	/** The touch controls go into `root`; CSS shows them only on coarse pointers */
	constructor(
		private actions: TInputActions,
		root: HTMLElement,
	) {
		const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
			window.addEventListener(type, fn);
			this.off.push(() => window.removeEventListener(type, fn));
		};
		on("keydown", (e) => this.keyDown(e));
		on("keyup", (e) => this.held.delete(e.code));
		// Keys released while the window had no focus never send keyup
		on("blur", () => this.held.clear());
		this.buildTouch(root);
	}

	/** The direction to walk this frame */
	dir(): TDirInput {
		if (isTyping()) return { dx: 0, dy: 0 };
		const k = keyDir(this.held);
		return k.dx || k.dy ? k : this.stick;
	}

	destroy(): void {
		for (const f of this.off) f();
		this.off = [];
	}

	private keyDown(e: KeyboardEvent): void {
		if (isTyping()) {
			if (e.code === "Escape") (document.activeElement as HTMLElement).blur();
			return;
		}
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		// Space and Enter press a focused button for keyboard users
		if ((e.code === "Space" || e.code === "Enter") && document.activeElement instanceof HTMLButtonElement) return;
		if (MOVE.has(e.code)) {
			e.preventDefault();
			this.held.add(e.code);
			return;
		}
		if (e.repeat) return;
		const a = this.actions;
		if (e.code === "KeyE" || e.code === "Space") a.use();
		else if (e.code === "KeyI") a.inventory();
		else if (e.code === "KeyL") a.lobbies();
		else if (e.code === "KeyT") a.emotes();
		else if (e.code === "Escape") a.close();
		else if (e.code === "Enter") {
			// A key held into the chat box must not keep walking after it
			this.held.clear();
			a.chat();
		} else if (/^Digit[1-9]$/.test(e.code)) a.slot(Number(e.code.slice(5)) - 1);
		else return;
		e.preventDefault();
	}

	// An 8-way stick bottom-left, A (use) and B (inventory) bottom-right
	private buildTouch(root: HTMLElement): void {
		const pad = document.createElement("div");
		pad.className = "touch";
		const stick = document.createElement("div");
		stick.className = "stick";
		const knob = document.createElement("div");
		knob.className = "knob";
		stick.append(knob);
		const btn = (label: string, cls: string, fn: () => void) => {
			const b = document.createElement("button");
			b.type = "button";
			b.className = `touch-btn ${cls}`;
			b.textContent = label;
			b.addEventListener("pointerdown", (e) => {
				e.preventDefault();
				fn();
			});
			return b;
		};
		pad.append(stick, btn("A", "btn-a", () => this.actions.use()), btn("B", "btn-b", () => this.actions.inventory()));
		root.append(pad);

		let id: number | null = null;
		const move = (e: PointerEvent) => {
			const r = stick.getBoundingClientRect();
			let x = e.clientX - (r.left + r.width / 2);
			let y = e.clientY - (r.top + r.height / 2);
			const len = Math.hypot(x, y);
			if (len > STICK_RADIUS) {
				x = (x / len) * STICK_RADIUS;
				y = (y / len) * STICK_RADIUS;
			}
			knob.style.transform = `translate(${x}px, ${y}px)`;
			this.stick = stickDir(x, y, DEAD_ZONE);
		};
		const end = (e: PointerEvent) => {
			if (e.pointerId !== id) return;
			id = null;
			knob.style.transform = "";
			this.stick = { dx: 0, dy: 0 };
		};
		stick.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			id = e.pointerId;
			stick.setPointerCapture(e.pointerId);
			move(e);
		});
		stick.addEventListener("pointermove", (e) => {
			if (e.pointerId === id) move(e);
		});
		stick.addEventListener("pointerup", end);
		stick.addEventListener("pointercancel", end);
	}
}
