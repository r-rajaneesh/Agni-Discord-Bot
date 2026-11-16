import { createCanvas } from "@napi-rs/canvas";

/** Line chart of hourly closes with a high/low band, for /market chart */
export async function renderChart(title: string, points: { hour: Date; close: number; high: number; low: number }[]) {
	const W = 720;
	const H = 320;
	const pad = { l: 56, r: 16, t: 40, b: 32 };
	const canvas = createCanvas(W, H);
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#1e1f22";
	ctx.fillRect(0, 0, W, H);
	ctx.fillStyle = "#ffffff";
	ctx.font = "bold 18px sans-serif";
	ctx.fillText(title, pad.l, 26);
	if (points.length < 2) {
		ctx.font = "15px sans-serif";
		ctx.fillStyle = "#b5bac1";
		ctx.fillText("Not enough history yet. Candles are written every hour.", pad.l, H / 2);
		return canvas.encode("png");
	}
	const lo = Math.min(...points.map((p) => p.low));
	const hi = Math.max(...points.map((p) => p.high));
	const span = hi - lo || 1;
	const x = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
	const y = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b);

	ctx.strokeStyle = "#3f4147";
	ctx.lineWidth = 1;
	ctx.font = "12px sans-serif";
	ctx.fillStyle = "#b5bac1";
	ctx.textAlign = "right";
	for (let g = 0; g <= 4; g++) {
		const v = lo + (span * g) / 4;
		ctx.beginPath();
		ctx.moveTo(pad.l, y(v));
		ctx.lineTo(W - pad.r, y(v));
		ctx.stroke();
		ctx.fillText(v.toFixed(v < 10 ? 2 : 0), pad.l - 6, y(v) + 4);
	}
	ctx.textAlign = "left";
	ctx.fillText(points[0]!.hour.toISOString().slice(5, 16).replace("T", " "), pad.l, H - 10);
	ctx.textAlign = "right";
	ctx.fillText(points.at(-1)!.hour.toISOString().slice(5, 16).replace("T", " ") + " UTC", W - pad.r, H - 10);

	ctx.fillStyle = "rgba(88,101,242,0.18)";
	ctx.beginPath();
	points.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.high)) : ctx.moveTo(x(i), y(p.high))));
	for (let i = points.length - 1; i >= 0; i--) ctx.lineTo(x(i), y(points[i]!.low));
	ctx.closePath();
	ctx.fill();

	ctx.strokeStyle = "#5865f2";
	ctx.lineWidth = 2.5;
	ctx.beginPath();
	points.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.close)) : ctx.moveTo(x(i), y(p.close))));
	ctx.stroke();
	return canvas.encode("png");
}
