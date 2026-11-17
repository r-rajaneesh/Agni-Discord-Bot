// Chat box: the last 100 messages coloured by channel, and the input. Text always goes in through textContent.
import type { TChatChannel } from "@game/chat";
import { CHAT_MAX } from "@game/chat";
import type { TServerMsg } from "@game/protocol";
import { button, el } from "./dom";

export const CHAT_KEEP = 100;
export type TChatMsg = Extract<TServerMsg, { t: "chat" }>;

const TAG: Record<TChatChannel, string> = { local: "", private: "[P] ", global: "[G] " };

export class ChatPanel {
	readonly root = el("div", "chat");
	private log = el("div", "chat-log");
	private toggle: HTMLButtonElement;
	private input: HTMLInputElement;
	// Phones have no Enter key to open the input, so it stays visible while the box is open
	private touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

	constructor(
		parent: HTMLElement,
		private send: (text: string) => void,
	) {
		this.log.setAttribute("role", "log");
		this.log.setAttribute("aria-live", "polite");
		this.toggle = button("💬", () => this.setOpen(this.root.classList.contains("chat-collapsed")), "btn chat-toggle");
		this.toggle.title = "Chat";
		this.toggle.setAttribute("aria-label", "Toggle chat");
		this.input = el("input", "chat-input");
		this.input.id = "chat-input";
		this.input.type = "text";
		this.input.maxLength = CHAT_MAX;
		this.input.autocomplete = "off";
		this.input.placeholder = "Message, /g global, /p private";
		this.input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				// The window's Enter handler would reopen the box as soon as it blurs
				e.stopPropagation();
				e.preventDefault();
				this.submit();
			} else if (e.key === "Escape") {
				e.stopPropagation();
				this.input.blur();
			}
		});
		this.input.addEventListener("blur", () => {
			if (!this.touch) this.input.hidden = true;
		});
		this.root.append(this.toggle, this.log, this.input);
		parent.append(this.root);
		this.setOpen(!this.touch);
		this.input.hidden = true;
	}

	/** Enter: opens the box and focuses the input */
	focus(): void {
		this.setOpen(true);
		this.input.hidden = false;
		this.input.focus();
	}

	add(m: TChatMsg): void {
		const line = el("div", `chat-line chat-${m.channel}`);
		line.append(el("span", "chat-from", `${TAG[m.channel]}${m.from.name}: `), el("span", "chat-text", m.text));
		this.log.append(line);
		while (this.log.children.length > CHAT_KEEP) this.log.firstElementChild!.remove();
		this.log.scrollTop = this.log.scrollHeight;
		if (this.root.classList.contains("chat-collapsed")) this.toggle.classList.add("chat-unread");
	}

	private setOpen(open: boolean): void {
		this.root.classList.toggle("chat-collapsed", !open);
		if (open) {
			this.toggle.classList.remove("chat-unread");
			this.input.hidden = !this.touch;
			this.log.scrollTop = this.log.scrollHeight;
		} else {
			this.input.hidden = true;
			this.input.blur();
		}
	}

	private submit(): void {
		const text = this.input.value.trim();
		this.input.value = "";
		if (text) this.send(text);
		this.input.blur();
	}
}
