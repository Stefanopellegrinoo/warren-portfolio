"use client";

import { useEffect, useState } from "react";

export interface ChartTheme {
	bg: string;
	ink: string;
	ink2: string;
	ink3: string;
	line: string;
	lineStrong: string;
	up: string;
	down: string;
	accent: string;
	font: string;
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
		up: v("--ok-dot"),
		down: v("--danger-dot"),
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
