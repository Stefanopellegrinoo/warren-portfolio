"use client";

import { useEffect, useState } from "react";
import { CANDLE_COLORS } from "@/lib/chart/indicator-specs";

export interface ChartTheme {
	bg: string;
	ink: string;
	ink2: string;
	ink3: string;
	line: string;
	lineStrong: string;
	/** The grid, both ways: the ink, faint. */
	grid: string;
	up: string;
	down: string;
	accent: string;
	font: string;
}

// The grid's alpha over the ink (odd/tasks/chart-pro-redesign.md S6).
const GRID_ALPHA = 0.07;
/** A #rrggbb token at `alpha`; any other color as it is. */
function faint(hex: string, alpha: number) {
	if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
	const n = parseInt(hex.slice(1), 16);
	return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function readTheme(): ChartTheme {
	const css = getComputedStyle(document.documentElement);
	const v = (name: string) => css.getPropertyValue(name).trim();
	return {
		bg: v("--bg"),
		ink: v("--ink"),
		ink2: v("--ink-2"),
		ink3: v("--ink-3"),
		line: v("--line"),
		lineStrong: v("--line-strong"),
		grid: faint(v("--ink"), GRID_ALPHA),
		// TradingView's candles on the chart only: the app's --ok-dot and --danger-dot stay for the rest.
		up: CANDLE_COLORS.up,
		down: CANDLE_COLORS.down,
		accent: v("--accent"),
		font: getComputedStyle(document.body).fontFamily,
	};
}

/** The design tokens as concrete colors (the chart canvas cannot read CSS
 *  variables), re-read when the theme or the system preference changes. */
export function useChartTheme(): ChartTheme | null {
	const [theme, setTheme] = useState<ChartTheme | null>(null);

	useEffect(() => {
		const update = () => setTheme(readTheme());
		update();
		const observer = new MutationObserver(update);
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		media.addEventListener("change", update);
		return () => {
			observer.disconnect();
			media.removeEventListener("change", update);
		};
	}, []);

	return theme;
}
