export const LINK_COOLDOWN_MS = 30_000;
const MAX_ENTRIES = 1000;

/** One Razorpay link per player and product per 30 s, shared by the Activity and /shop so a double click makes one link */
export default class LinkCooldown {
	private sentAt = new Map<string, number>();

	/** Claims the slot before any await; false while a link for this product went out less than 30 s ago */
	claim(userId: string, productId: string, now: number): boolean {
		const key = `${userId}:${productId}`;
		const sent = this.sentAt.get(key);
		if (sent !== undefined && now - sent < LINK_COOLDOWN_MS) return false;
		this.sentAt.set(key, now);
		if (this.sentAt.size > MAX_ENTRIES) for (const [k, at] of this.sentAt) if (now - at >= LINK_COOLDOWN_MS) this.sentAt.delete(k);
		return true;
	}

	/** Frees the slot when no link reached the player */
	release(userId: string, productId: string): void {
		this.sentAt.delete(`${userId}:${productId}`);
	}
}
