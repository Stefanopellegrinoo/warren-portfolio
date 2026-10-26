import type { SeriesMarker, UTCTimestamp } from "lightweight-charts";
import type { Transaction } from "@/types";
import { formatNumber } from "@/lib/utils";

/** A buy or a sell as the Historial lists it (the engine's quantity and price). */
export type Trade = Pick<Transaction, "id" | "date" | "operation" | "quantity" | "price">;

const DAY_S = 86_400;

/** The trade's day in chart time: UTC midnight, as daily bars have it. */
const dayOf = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / 1000;

/** Quantities keep their own decimals, up to six, like the Historial. */
export function qtyText(n: number) {
	const rounded = Number(n.toFixed(6));
	return formatNumber(rounded, { decimals: (String(rounded).split(".")[1] ?? "").length });
}

/**
 * The buys and sells in each bar, oldest first. A trade goes in the first bar of its day
 * (intraday), else in the last bar that opens on or before it (its week or month, or the last
 * trading day before a day with no bar). Dividends and trades before the first bar are left out.
 */
export function tradesByBar(trades: readonly Trade[], times: readonly number[]): Map<number, Trade[]> {
	const byBar = new Map<number, Trade[]>();
	const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
	for (const t of sorted) {
		if (t.operation !== "COMPRA" && t.operation !== "VENTA") continue;
		const day = dayOf(t.date);
		// The first bar that opens on or after the trade's day.
		let lo = 0;
		let hi = times.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (times[mid] < day) lo = mid + 1;
			else hi = mid;
		}
		const i = lo < times.length && times[lo] < day + DAY_S ? lo : lo - 1;
		if (i < 0) continue;
		const list = byBar.get(times[i]);
		if (list) list.push(t);
		else byBar.set(times[i], [t]);
	}
	return byBar;
}

/** One arrow per side and bar, in time order: buys green under it, sells red over it. Only the arrow: tapping it shows the operations. */
export function tradeMarkers(byBar: Map<number, Trade[]>, colors: { up: string; down: string }): SeriesMarker<UTCTimestamp>[] {
	const markers: SeriesMarker<UTCTimestamp>[] = [];
	for (const time of [...byBar.keys()].sort((a, b) => a - b)) {
		const has = (op: Trade["operation"]) => byBar.get(time)!.some((t) => t.operation === op);
		const at = time as UTCTimestamp;
		if (has("COMPRA")) markers.push({ time: at, position: "belowBar", shape: "arrowUp", color: colors.up });
		if (has("VENTA")) markers.push({ time: at, position: "aboveBar", shape: "arrowDown", color: colors.down });
	}
	return markers;
}
