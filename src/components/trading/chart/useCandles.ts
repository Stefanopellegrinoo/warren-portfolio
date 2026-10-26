"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchKlines } from "@/lib/binance/rest";
import { getBinanceWS } from "@/lib/binance/ws";
import { getProviderForSymbol } from "@/lib/market-data/resolver";
import { klinesInterval, toChartTime } from "@/lib/chart/timeframes";
import { barsToUpdate, mergeRecent } from "@/lib/chart/live-bars";
import { requestErrorMessage } from "@/lib/request-errors";
import type { Candle, Timeframe } from "@/lib/binance/types";
import { PORTFOLIO_SERIES, type CompareSeriesResponse } from "@/lib/compare-series";

const POLL_MS = 30_000;
const CANDLES_FAILED = "No se pudieron cargar las velas. Probá de nuevo.";
const NO_PORTFOLIO_HISTORY = "Todavía no hay historia de tu cartera";
// Days of recent bars a stock's poll asks for: wide enough to hold the last drawn bar over a
// weekend or a holiday, small next to the history.
const RECENT_DAYS: Record<ReturnType<typeof klinesInterval>, number> = { "15m": 7, "1h": 10, "1d": 14, "1w": 60, "1mo": 400 };
const MEMORY_MAX = 12;

/** reset: draw every bar again; update: series.update() these bars in order. */
export type CandleChange = { kind: "reset" } | { kind: "update"; bars: Candle[] };

export interface CandleState {
	status: "loading" | "ready" | "error";
	candles: Candle[];
	change: CandleChange;
	error?: string;
}

const LOADING: CandleState = { status: "loading", candles: [], change: { kind: "reset" } };

// The candles of the assets and timeframes seen in this tab, newest last: one seen before
// opens at once and refreshes behind (odd/tasks/rendimiento.md S4).
const memory = new Map<string, Candle[]>();
function remember(key: string, candles: Candle[]) {
	memory.delete(key);
	memory.set(key, candles);
	if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value as string);
}
/** Forgets every remembered candle (tests, and a sign-out). */
export function forgetCandles() {
	memory.clear();
}

async function fetchYahoo(symbol: string, tf: Timeframe, signal: AbortSignal, days?: number): Promise<Candle[]> {
	const res = await fetch(
		`/api/klines?ticker=${encodeURIComponent(symbol)}&interval=${klinesInterval(tf)}${days ? `&days=${days}` : ""}`,
		{ signal },
	);
	const body = await res.json().catch(() => null);
	if (!res.ok) throw new Error(body?.error ?? "");
	return (body as { time: string | number; open: number; high: number; low: number; close: number; volume?: number }[]).map(
		(k) => ({ time: toChartTime(k.time), open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume ?? 0 }),
	);
}

/** Mi cartera: one value a day, as bars whose every price is that value, so indicators read it like a close. */
async function fetchPortfolio(signal: AbortSignal): Promise<Candle[]> {
	const res = await fetch(`/api/compare-series?symbols=${PORTFOLIO_SERIES}`, { signal });
	const body = await res.json().catch(() => null);
	if (!res.ok) throw new Error(body?.error ?? "");
	const result = (body as CompareSeriesResponse).series[PORTFOLIO_SERIES];
	if (!result || "error" in result) throw new Error(NO_PORTFOLIO_HISTORY);
	return result.points.map((p) => ({ time: toChartTime(p.time), open: p.value, high: p.value, low: p.value, close: p.value, volume: 0 }));
}

function withBar(candles: Candle[], c: Candle): Candle[] {
	const last = candles.at(-1);
	if (last && last.time === c.time) return [...candles.slice(0, -1), c];
	return [...candles, c];
}

/**
 * Candles for one symbol and timeframe, kept live: Binance through its kline stream, Yahoo by
 * loading the history once (cached 10 min on the server) and re-polling a recent window every
 * 30 s (cached 30 s), so new bars appear only when the source really has them. An asset seen
 * before in this tab opens at once from memory while it refreshes.
 */
export function useCandles(symbol: string, timeframe: Timeframe) {
	const [state, setState] = useState<CandleState>(LOADING);
	const [attempt, setAttempt] = useState(0);
	const retry = useCallback(() => setAttempt((n) => n + 1), []);

	useEffect(() => {
		const ctrl = new AbortController();
		const key = `${symbol}:${timeframe}`;
		const seen = memory.get(key);
		let stop: (() => void) | null = null;
		setState(seen ? { status: "ready", candles: seen, change: { kind: "reset" } } : LOADING);

		// A fresh load: drawn over the remembered bars when it continues them, redrawn otherwise.
		const show = (candles: Candle[]) => {
			remember(key, candles);
			setState((s) => {
				const bars = s.status === "ready" ? barsToUpdate(s.candles, candles) : null;
				if (bars?.length === 0) return s.candles.length === candles.length ? s : { ...s, candles };
				return { status: "ready", candles, change: bars && s.candles.length <= candles.length ? { kind: "update", bars } : { kind: "reset" } };
			});
		};
		const fail = (e: unknown) => {
			// A failed refresh keeps the remembered bars on screen; only a first load shows the error.
			if (ctrl.signal.aborted || seen) return;
			setState({ ...LOADING, status: "error", error: requestErrorMessage(e, CANDLES_FAILED) });
		};

		(async () => {
			try {
				const source = getProviderForSymbol(symbol);
				if (source === "portfolio") {
					// Daily values that change once a day: loaded once, never polled.
					const candles = await fetchPortfolio(ctrl.signal);
					if (!ctrl.signal.aborted) show(candles);
					return;
				}
				if (source === "binance") {
					// Binance's own errors ("klines 451") say nothing to the user; a dropped connection does.
					const candles = await fetchKlines(symbol, timeframe).catch((e) => {
						throw e instanceof TypeError ? e : new Error("");
					});
					if (ctrl.signal.aborted) return;
					show(candles);
					stop = getBinanceWS().subscribeKline({
						symbol,
						interval: timeframe,
						onCandle: (c) =>
							setState((s) => {
								const candles = withBar(s.candles, c);
								remember(key, candles);
								return { ...s, candles, change: { kind: "update", bars: [c] } };
							}),
					});
					return;
				}

				const recentDays = RECENT_DAYS[klinesInterval(timeframe)];
				const loadAll = async () => {
					const [history, recent] = await Promise.all([
						fetchYahoo(symbol, timeframe, ctrl.signal),
						fetchYahoo(symbol, timeframe, ctrl.signal, recentDays).catch(() => []),
					]);
					return [...(mergeRecent(history, recent) ?? history)];
				};
				const candles = await loadAll();
				if (ctrl.signal.aborted) return;
				show(candles);
				const id = setInterval(async () => {
					try {
						const recent = await fetchYahoo(symbol, timeframe, ctrl.signal, recentDays);
						let gap = false;
						setState((s) => {
							const merged = mergeRecent(s.candles, recent);
							if (!merged) {
								gap = true;
								return s;
							}
							const bars = barsToUpdate(s.candles, recent);
							if (merged === s.candles || bars?.length === 0) return s;
							remember(key, [...merged]);
							return { ...s, candles: [...merged], change: bars ? { kind: "update", bars } : { kind: "reset" } };
						});
						// The window no longer reaches the drawn bars (the tab slept for days): load it all again.
						if (gap) show(await loadAll());
					} catch {
						// A failed poll keeps the drawn bars; the next poll retries.
					}
				}, POLL_MS);
				stop = () => clearInterval(id);
			} catch (e) {
				fail(e);
			}
		})();

		return () => {
			ctrl.abort();
			stop?.();
		};
	}, [symbol, timeframe, attempt]);

	return { ...state, retry };
}
