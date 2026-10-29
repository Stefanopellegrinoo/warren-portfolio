"use client";

import { useEffect, useReducer } from "react";
import { fetchKlines } from "@/lib/binance/rest";
import { getProviderForSymbol } from "@/lib/market-data/resolver";
import { cachedValue, load, setCachedValue } from "@/lib/client-cache";
import { fetchTickerSearch } from "@/components/trading/chart/SymbolSelector";

/**
 * What a wider list adds to each row (odd/tasks/chart-pro-redesign.md S5): the asset's name from
 * 360 px, its last month as a line from 460 px. Asked for only once the list is that wide, once per
 * symbol: names are kept on the device, lines in this tab's memory. Decoration only: a failed or
 * empty answer shows the row as at 280 px and is not asked again in this tab.
 */
export const NAME_FROM_PX = 360;
export const LINE_FROM_PX = 460;
// About a month of trading days, and the calendar days that hold them.
const LINE_BARS = 22;
const LINE_DAYS = 35;
const NAMES_KEY = "warren:watchlist-names";
const nameKey = (s: string) => `watchlist-name:${s}`;
const lineKey = (s: string) => `watchlist-line:${s}`;

function readNames(): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(NAMES_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function saveName(symbol: string, name: string) {
  try {
    window.localStorage.setItem(NAMES_KEY, JSON.stringify({ ...readNames(), [symbol]: name }));
  } catch {
    // No storage: asked again on the next visit.
  }
}

/** The symbol search the asset dialog uses; only an exact match names the row. */
async function fetchName(symbol: string): Promise<string> {
  const results = await fetchTickerSearch(symbol);
  return results.find((r) => r.symbol.toUpperCase() === symbol.toUpperCase())?.shortname ?? "";
}

/** The same requests the chart makes for its bars (useCandles), for a month of daily closes. */
async function fetchLine(symbol: string): Promise<number[] | null> {
  let closes: number[];
  if (getProviderForSymbol(symbol) === "binance") {
    closes = (await fetchKlines(symbol, "1d", LINE_BARS)).map((k) => k.close);
  } else {
    const res = await fetch(`/api/klines?ticker=${encodeURIComponent(symbol)}&interval=1d&days=${LINE_DAYS}`);
    if (!res.ok) return null;
    closes = ((await res.json()) as { close: number }[]).map((k) => k.close);
  }
  const month = closes.slice(-LINE_BARS);
  return month.length > 1 ? month : null;
}

export function useWatchlistExtras(symbols: string[], width: number) {
  const showName = width >= NAME_FROM_PX;
  const showLine = width >= LINE_FROM_PX;
  const [, answered] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!showName) return;
    let live = true;
    const saved = readNames();
    let seeded = false;
    for (const s of symbols) {
      // Crypto has no name source (Binance gives none): its symbol and USDT tag, as today.
      if (getProviderForSymbol(s) !== "yahoo" || cachedValue(nameKey(s)) !== undefined) continue;
      if (saved[s]) {
        setCachedValue(nameKey(s), saved[s]);
        seeded = true;
        continue;
      }
      void load(nameKey(s), () => fetchName(s).catch(() => "")).then((name) => {
        if (name) saveName(s, name);
        if (live) answered();
      });
    }
    if (seeded) answered();
    return () => {
      live = false;
    };
  }, [symbols, showName]);

  useEffect(() => {
    if (!showLine) return;
    let live = true;
    for (const s of symbols) {
      if (cachedValue(lineKey(s)) !== undefined) continue;
      void load(lineKey(s), () => fetchLine(s).catch(() => null)).then(() => {
        if (live) answered();
      });
    }
    return () => {
      live = false;
    };
  }, [symbols, showLine]);

  return {
    showName,
    showLine,
    name: (s: string) => (showName ? cachedValue<string>(nameKey(s)) || null : null),
    line: (s: string) => (showLine ? cachedValue<number[] | null>(lineKey(s)) ?? null : null),
  };
}
