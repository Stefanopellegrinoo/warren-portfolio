"use client";

import { useEffect, useState } from "react";
import type { CompareSeriesResponse, SeriesPoint, SeriesResult } from "@/lib/compare-series";

export interface CompareState {
	status: "idle" | "loading" | "ready" | "error";
	series: Record<string, SeriesResult>;
	/** ARS per USD, when asked for: a peso chart is drawn in dollars while compared. */
	ccl?: SeriesPoint[];
}

const IDLE: CompareState = { status: "idle", series: {} };

/** The daily USD series of the compared assets, in one request; nothing is asked for with nothing to compare. */
export function useCompareSeries(symbols: string[], ccl: boolean): CompareState {
	const [state, setState] = useState<CompareState>(IDLE);
	const key = symbols.join(",");

	useEffect(() => {
		if (!key) {
			setState(IDLE);
			return;
		}
		const ctrl = new AbortController();
		setState((s) => ({ ...s, status: "loading" }));
		fetch(`/api/compare-series?symbols=${encodeURIComponent(key)}${ccl ? "&ccl=1" : ""}`, { signal: ctrl.signal })
			.then(async (res) => {
				if (!res.ok) throw new Error();
				const body = (await res.json()) as CompareSeriesResponse;
				setState({ status: "ready", series: body.series, ccl: body.ccl });
			})
			.catch(() => {
				if (!ctrl.signal.aborted) setState({ status: "error", series: {} });
			});
		return () => ctrl.abort();
	}, [key, ccl]);

	return state;
}
