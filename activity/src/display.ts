// Pure display maths: how sharp to render on this screen, and player colours as tints

/** Device pixels per CSS pixel the game renders at: the screen's ratio, capped at 2 to bound GPU cost */
export function deviceScale(dpr: number): number {
	return Number.isFinite(dpr) && dpr > 1 ? Math.min(dpr, 2) : 1;
}

/** The canvas size in device pixels for a CSS box, and the zoom that shows it at CSS size */
export function canvasSize(cssW: number, cssH: number, k: number): { width: number; height: number; zoom: number } {
	return { width: Math.max(1, Math.round(cssW * k)), height: Math.max(1, Math.round(cssH * k)), zoom: 1 / k };
}

/** The player's colour as a tint; anything unreadable leaves the shirt white */
export function tintOf(colour: string): number {
	const m = /^#([0-9a-f]{6})$/i.exec(colour);
	return m ? parseInt(m[1]!, 16) : 0xffffff;
}
