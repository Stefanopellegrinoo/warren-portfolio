/**
 * The chart's pane heights (odd/tasks/chart-pro-redesign.md S1, S7): the price keeps about half, the open
 * indicator panes share the rest equally within a legible minimum and a maximum, a minimized pane is a thin
 * strip. The price never falls under 40 %: before that, the indicator panes go under their minimum.
 */

export const MINIMIZED_PANE_PX = 24;
const PRICE_SHARE = { desktop: 0.56, phone: 0.5 };
const PANE_MIN_PX = { desktop: 72, phone: 58 };
const PANE_MAX_PX = 150;
const PRICE_FLOOR = 0.4;
const SEPARATOR_PX = 1;

/** Heights in px, the price pane first, for `available` px and the indicator panes in order (true: minimized). */
export function paneHeights(available: number, phone: boolean, minimized: boolean[]): number[] {
	const device = phone ? "phone" : "desktop";
	const open = minimized.filter((m) => !m).length;
	const room = available - (minimized.length - open) * MINIMIZED_PANE_PX;
	let pane = open ? Math.min(PANE_MAX_PX, Math.max(PANE_MIN_PX[device], (room * (1 - PRICE_SHARE[device])) / open)) : 0;
	let price = room - pane * open;
	if (open && price < room * PRICE_FLOOR) {
		price = room * PRICE_FLOOR;
		pane = (room - price) / open;
	}
	return [price, ...minimized.map((m) => (m ? MINIMIZED_PANE_PX : pane))];
}

/** Where each pane starts, from the top of the chart: under the panes before it and their separators. */
export function paneTops(heights: number[]): number[] {
	let top = 0;
	return heights.map((h) => {
		const at = top;
		top += h + SEPARATOR_PX;
		return at;
	});
}
