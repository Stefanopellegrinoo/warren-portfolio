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
const LOADING: CompareState = { status: "loading", series: {} };

/** The daily USD series of the compared assets, in one request; nothing is asked for with nothing to compare. */
export function useCompareSeries(symbols: string[], ccl: boolean): CompareState {
	const symbolsKey = symbols.join(",");
	const request = symbolsKey ? `/api/compare-series?symbols=${encodeURIComponent(symbolsKey)}${ccl ? "&ccl=1" : ""}` : "";
	// The answer to one request; another request reads as loading until its own answer lands.
	const [answer, setAnswer] = useState<{ request: string; state: CompareState } | null>(null);

	useEffect(() => {
		if (!request) return;
		const ctrl = new AbortController();
		fetch(request, { signal: ctrl.signal })
			.then(async (res) => {
				if (!res.ok) throw new Error();
				const body = (await res.json()) as CompareSeriesResponse;
				setAnswer({ request, state: { status: "ready", series: body.series, ccl: body.ccl } });
			})
			.catch(() => {
				if (!ctrl.signal.aborted) setAnswer({ request, state: { status: "error", series: {} } });
			});
		return () => ctrl.abort();
	}, [request]);

	if (!request) return IDLE;
	return answer?.request === request ? answer.state : LOADING;
}
