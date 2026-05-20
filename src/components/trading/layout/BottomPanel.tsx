"use client";

import { useEffect, useState } from "react";
import { useChartStore } from "@/lib/store/chart-store";
import { fetchTicker24h } from "@/lib/binance/rest";
import { getProviderForSymbol } from "@/lib/market-data/resolver";
import type { Ticker24h } from "@/lib/binance/types";
import { formatPrice, formatPct, formatVolume } from "@/lib/format";
import { cn } from "@/lib/utils";

type YahooQuote = { price: number; change: number; changePct: number };

export function BottomPanel() {
  const symbol = useChartStore((s) => s.symbol);
  const provider = getProviderForSymbol(symbol);
  const [t, setT] = useState<Ticker24h | null>(null);
  const [yQuote, setYQuote] = useState<YahooQuote | null>(null);

  // Binance branch: poll fetchTicker24h every 5s
  useEffect(() => {
    if (provider !== "binance") {
      setT(null);
      return;
    }
    let cancelled = false;
    setT(null);
    const load = () => {
      fetchTicker24h(symbol)
        .then((x) => { if (!cancelled) setT(x); })
        .catch(console.error);
    };
    load();
    const id = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbol, provider]);

  // Yahoo branch: poll /api/quote every 60s
  useEffect(() => {
    if (provider !== "yahoo") {
      setYQuote(null);
      return;
    }
    let cancelled = false;
    setYQuote(null);
    const load = async () => {
      try {
        const res = await fetch(`/api/quote?tickers=${encodeURIComponent(symbol)}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as Array<{ price: number; change: number; change_pct: number }>;
        const q = data[0];
        if (q && !cancelled) {
          setYQuote({ price: q.price, change: q.change ?? 0, changePct: q.change_pct ?? 0 });
        }
      } catch {
        // silent — stats are non-critical
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbol, provider]);

  const upClass = (n: number) => (n >= 0 ? "text-tv-green" : "text-tv-red");

  if (provider === "yahoo") {
    return (
      <div className="flex h-9 items-center gap-0 border-t border-tv-border bg-tv-panel px-3 text-xs">
        <Stat label="Símbolo" value={symbol} />
        <Stat
          label="Cambio"
          value={yQuote ? formatPrice(yQuote.change) : "—"}
          valueClass={yQuote ? upClass(yQuote.change) : ""}
        />
        <Stat
          label="Cambio %"
          value={yQuote ? formatPct(yQuote.changePct) : "—"}
          valueClass={yQuote ? upClass(yQuote.changePct) : ""}
        />
        <Stat label="Precio" value={yQuote ? formatPrice(yQuote.price) : "—"} />
        <div className="ml-auto flex items-center gap-2 text-[10px] text-tv-text-dim">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
          <span>Yahoo Finance · EOD</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-9 items-center gap-0 border-t border-tv-border bg-tv-panel px-3 text-xs">
      <Stat label="Símbolo" value={symbol} />
      <Stat
        label="24h Cambio"
        value={t ? formatPct(t.priceChangePercent) : "—"}
        valueClass={t ? upClass(t.priceChangePercent) : ""}
      />
      <Stat label="24h Alto" value={t ? formatPrice(t.highPrice) : "—"} valueClass="text-tv-green" />
      <Stat label="24h Bajo" value={t ? formatPrice(t.lowPrice) : "—"} valueClass="text-tv-red" />
      <Stat label="24h Vol (base)" value={t ? formatVolume(t.volume) : "—"} />
      <Stat label="24h Vol (USDT)" value={t ? formatVolume(t.quoteVolume) : "—"} />
      <div className="ml-auto flex items-center gap-2 text-[10px] text-tv-text-dim">
        <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-tv-green" />
        <span>Binance · Live</span>
      </div>
    </div>
  );
}

function Stat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center gap-1.5 border-r border-tv-border px-3">
      <span className="text-tv-text-dim">{label}</span>
      <span className={cn("font-medium tabular-nums", valueClass ?? "text-tv-text")}>{value}</span>
    </div>
  );
}
