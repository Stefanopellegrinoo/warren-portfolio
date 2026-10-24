"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchKlines } from "@/lib/binance/rest";
import { getBinanceWS } from "@/lib/binance/ws";
import { getProviderForSymbol } from "@/lib/market-data/resolver";
import { klinesInterval, toChartTime } from "@/lib/chart/timeframes";
import { barsToUpdate } from "@/lib/chart/live-bars";
import { requestErrorMessage } from "@/lib/request-errors";
import type { Candle, Timeframe } from "@/lib/binance/types";

const POLL_MS = 30_000;
const CANDLES_FAILED = "No se pudieron cargar las velas. Probá de nuevo.";

/** reset: draw every bar again; update: series.update() these bars in order. */
export type CandleChange = { kind: "reset" } | { kind: "update"; bars: Candle[] };

export interface CandleState {
	status: "loading" | "ready" | "error";
	candles: Candle[];
	change: CandleChange;
	error?: string;
}

const LOADING: CandleState = { status: "loading", candles: [], change: { kind: "reset" } };

async function fetchYahoo(symbol: string, tf: Timeframe, signal: AbortSignal): Promise<Candle[]> {
	const res = await fetch(
		`/api/klines?ticker=${encodeURIComponent(symbol)}&interval=${klinesInterval(tf)}`,
		{ signal },
	);
	const body = await res.json().catch(() => null);
	if (!res.ok) throw new Error(body?.error ?? "");
	return (body as { time: string | number; open: number; high: number; low: number; close: number; volume?: number }[]).map(
		(k) => ({ time: toChartTime(k.time), open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume ?? 0 }),
	);
}

function withBar(candles: Candle[], c: Candle): Candle[] {
	const last = candles.at(-1);
	if (last && last.time === c.time) return [...candles.slice(0, -1), c];
	return [...candles, c];
}

/**
 * Candles for one symbol and timeframe, kept live: Binance through its kline
 * stream, Yahoo by re-polling /api/klines every 30 s (cached 30 s on the
 * server), so new bars appear only when the source really has them.
 */
export function useCandles(symbol: string, timeframe: Timeframe) {
	const [state, setState] = useState<CandleState>(LOADING);
	const [attempt, setAttempt] = useState(0);
	const retry = useCallback(() => setAttempt((n) => n + 1), []);

	useEffect(() => {
		const ctrl = new AbortController();
		let stop: (() => void) | null = null;
		setState(LOADING);

		const fail = (e: unknown) => {
			if (ctrl.signal.aborted) return;
			setState({ ...LOADING, status: "error", error: requestErrorMessage(e, CANDLES_FAILED) });
		};

		(async () => {
			try {
				if (getProviderForSymbol(symbol) === "binance") {
					// Binance's own errors ("klines 451") say nothing to the user; a dropped connection does.
					const candles = await fetchKlines(symbol, timeframe).catch((e) => {
						throw e instanceof TypeError ? e : new Error("");
					});
					if (ctrl.signal.aborted) return;
					setState({ status: "ready", candles, change: { kind: "reset" } });
					stop = getBinanceWS().subscribeKline({
						symbol,
						interval: timeframe,
						onCandle: (c) =>
							setState((s) => ({ ...s, candles: withBar(s.candles, c), change: { kind: "update", bars: [c] } })),
					});
					return;
				}

				const candles = await fetchYahoo(symbol, timeframe, ctrl.signal);
				if (ctrl.signal.aborted) return;
				setState({ status: "ready", candles, change: { kind: "reset" } });
				const id = setInterval(async () => {
					try {
						const polled = await fetchYahoo(symbol, timeframe, ctrl.signal);
						setState((s) => {
							const bars = barsToUpdate(s.candles, polled);
							if (bars?.length === 0) return s;
							return { ...s, candles: polled, change: bars ? { kind: "update", bars } : { kind: "reset" } };
						});
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
