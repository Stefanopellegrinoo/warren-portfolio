/**
 * Where the favorites bar sits and whether it shows (odd/tasks/chart-customization.md S3): kept per
 * device, since a phone and a computer differ, and never in the account. The starred tools themselves
 * are the account's (the chart preferences, S4).
 */
const STORAGE_KEY = "warren:chart-favorites-bar";
// How far the bar keeps from the chart's edges.
const EDGE_PX = 4;

export interface BarPosition {
	x: number;
	y: number;
}
interface BarState {
	shown: boolean;
	position: BarPosition | null;
}
interface Size {
	width: number;
	height: number;
}

export function readBar(): BarState {
	try {
		const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
		const p = saved?.position;
		return {
			shown: saved?.shown !== false,
			position: Number.isFinite(p?.x) && Number.isFinite(p?.y) ? { x: p.x, y: p.y } : null,
		};
	} catch {
		// No storage (private mode, blocked site data) or a broken copy: shown, at its default spot.
		return { shown: true, position: null };
	}
}

export function saveBar(change: Partial<BarState>) {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readBar(), ...change }));
	} catch {
		// Same: this visit only.
	}
}

/** `want`, moved as little as needed for a `bar`-sized box to stay inside an `area`-sized one. */
export function clampBar(want: BarPosition, bar: Size, area: Size): BarPosition {
	const fit = (v: number, room: number) => Math.max(EDGE_PX, Math.min(v, room - EDGE_PX));
	return { x: fit(want.x, area.width - bar.width), y: fit(want.y, area.height - bar.height) };
}
