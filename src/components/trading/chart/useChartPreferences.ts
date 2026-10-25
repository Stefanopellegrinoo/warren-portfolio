"use client";

import { useSyncExternalStore } from "react";
import {
	getPreferences,
	setFavorite,
	setIndicatorSettings,
	setToolStyle,
	subscribe,
} from "@/lib/chart/preferences";
import { EMPTY_PREFERENCES } from "@/lib/chart/preferences-schema";

const serverSnapshot = () => EMPTY_PREFERENCES;

/**
 * The account's chart preferences (favorite tools, remembered drawing styles, saved indicator
 * settings) and their setters. Every component shares one copy per tab; a change shows on the next
 * render and is saved behind (src/lib/chart/preferences.ts).
 */
export function useChartPreferences() {
	const preferences = useSyncExternalStore(subscribe, getPreferences, serverSnapshot);
	return { preferences, setFavorite, setToolStyle, setIndicatorSettings };
}
