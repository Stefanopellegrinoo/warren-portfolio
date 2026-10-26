"use client";

import { useEffect, useState } from "react";
import { fetchTicker24h } from "@/lib/binance/rest";
import { getProviderForSymbol } from "@/lib/market-data/resolver";

/** Last price and day change (a fraction) of the chart's symbol. */
export interface Quote {
  price: number;
  changePct: number;
}

const BINANCE_POLL_MS = 5_000;
const YAHOO_POLL_MS = 15_000; // /api/quote is cached 15 s on the server

async function load(symbol: string): Promise<Quote | null> {
  if (getProviderForSymbol(symbol) === "binance") {
    const t = await fetchTicker24h(symbol);
    return { price: t.lastPrice, changePct: t.priceChangePercent / 100 };
  }
  const res = await fetch(`/api/quote?tickers=${encodeURIComponent(symbol)}`);
  if (!res.ok) return null;
  const [q] = (await res.json()) as Array<{ price: number | null; change_pct: number | null }>;
  return q && q.price !== null ? { price: q.price, changePct: (q.change_pct ?? 0) / 100 } : null;
}

// The one quote poll of the page: the top bar and the position panel share it.
export function useQuote(symbol: string): Quote | null {
  const [quote, setQuote] = useState<Quote | null>(null);

  useEffect(() => {
    let cancelled = false;
    setQuote(null);
    // Mi cartera has no market quote: its value is on the chart.
    if (getProviderForSymbol(symbol) === "portfolio") return;
    const tick = () =>
      load(symbol)
        .then((q) => { if (!cancelled && q) setQuote(q); })
        .catch(() => { /* keep the last quote; the chart shows its own errors */ });
    tick();
    const id = setInterval(tick, getProviderForSymbol(symbol) === "binance" ? BINANCE_POLL_MS : YAHOO_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbol]);

  return quote;
}
