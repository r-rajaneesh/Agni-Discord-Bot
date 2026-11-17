// A tiny stand-in for the DOM, just enough for the overlay classes in unit tests. Tests only; nothing in the app imports it.

class FakeClassList {
	private set = new Set<string>();

	constructor(init = "") {
		this.value = init;
	}

	get value(): string {
		return [...this.set].join(" ");
	}

	set value(v: string) {
		this.set = new Set(v.split(/\s+/).filter(Boolean));
	}

	add(...c: string[]): void {
		for (const x of c) this.set.add(x);
	}

	remove(...c: string[]): void {
		for (const x of c) this.set.delete(x);
	}

	contains(c: string): boolean {
		return this.set.has(c);
	}

	toggle(c: string, force?: boolean): boolean {
		const on = force ?? !this.set.has(c);
		if (on) this.set.add(c);
		else this.set.delete(c);
		return on;
	}
}

export class FakeElement {
	readonly classList = new FakeClassList();
	readonly style: Record<string, string> = {};
	children: FakeElement[] = [];
	parent: FakeElement | null = null;
	hidden = false;
	disabled = false;
	scrollTop = 0;
	scrollHeight = 0;
	value = "";
	title = "";
	private text = "";
	private attrs = new Map<string, string>();
	private listeners = new Map<string, ((e: unknown) => void)[]>();
	[k: string]: unknown;

	constructor(readonly tagName: string) {}

	get className(): string {
		return this.classList.value;
	}

	set className(v: string) {
		this.classList.value = v;
	}

	get textContent(): string {
		return this.text + this.children.map((c) => c.textContent).join("");
	}

	set textContent(v: string) {
		for (const c of this.children) c.parent = null;
		this.children = [];
		this.text = v;
	}

	get firstElementChild(): FakeElement | null {
		return this.children[0] ?? null;
	}

	append(...nodes: FakeElement[]): void {
		for (const n of nodes) {
			n.remove();
			n.parent = this;
			this.children.push(n);
		}
	}

	replaceChildren(...nodes: FakeElement[]): void {
		this.textContent = "";
		this.append(...nodes);
	}

	remove(): void {
		if (!this.parent) return;
		this.parent.children = this.parent.children.filter((c) => c !== this);
		this.parent = null;
	}

	setAttribute(k: string, v: string): void {
		this.attrs.set(k, v);
	}

	getAttribute(k: string): string | null {
		return this.attrs.get(k) ?? null;
	}

	addEventListener(type: string, fn: (e: unknown) => void): void {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
	}

	dispatch(type: string, e: unknown = {}): void {
		for (const fn of this.listeners.get(type) ?? []) fn(e);
	}

	click(): void {
		if (!this.disabled) this.dispatch("click");
	}

	focus(): void {}

	blur(): void {
		this.dispatch("blur");
	}

	/** Every descendant with this class, in document order */
	all(cls: string): FakeElement[] {
		return this.children.flatMap((c) => [...(c.classList.contains(cls) ? [c] : []), ...c.all(cls)]);
	}
}

/** Installs the fake `document` (once) */
export function installDom(): void {
	const g = globalThis as { document?: unknown };
	if (!g.document) g.document = { createElement: (tag: string) => new FakeElement(tag) };
}

/** A DOM element seen as the fake one */
export const fake = (e: unknown) => e as FakeElement;
