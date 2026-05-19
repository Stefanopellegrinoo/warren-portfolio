"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { Position, PortfolioSummary } from "@/types";
import { getPortfolio, getCedearRatios } from "@/lib/warren/positions";
import { useChartStore } from "@/lib/store/chart-store";
import { cn } from "@/lib/utils";

interface QuoteResult {
  ticker: string;
  price: number | null;
  change_pct: number | null;
  change: number;
}

// ── Pure utility exports (exported for unit testing) ──────────────────────────

/**
 * Computes daily P&L as sum of (change * quantity) across all positions.
 */
export function calcDayPnL(
  positions: Position[],
  changes: Map<string, number>
): number {
  return positions.reduce(
    (acc, p) => acc + (changes.get(p.ticker) ?? 0) * p.quantity,
    0
  );
}

/**
 * Returns true when at least one ticker in the changes map has a non-zero value.
 */
export function hasDayData(changes: Map<string, number>): boolean {
  if (changes.size === 0) return false;
  return [...changes.values()].some((v) => v !== 0);
}

/**
 * Computes daily P&L percentage.
 * Returns null when totalPortfolio - dayPnL === 0 to avoid division by zero.
 */
export function calcDayPnLPct(
  dayPnL: number,
  totalPortfolio: number
): number | null {
  const base = totalPortfolio - dayPnL;
  if (base === 0) return null;
  return (dayPnL / base) * 100;
}

type LoadState = "idle" | "loading" | "error";

const POLL_INTERVAL_MS = 60_000;

function formatUSDCompact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function PnLSidebar() {
  const setSymbol = useChartStore((s) => s.setSymbol);
  const setDataSource = useChartStore((s) => s.setDataSource);

  const [positions, setPositions] = useState<Position[]>([]);
  const [cashBalance, setCashBalance] = useState<number | null>(null);
  const [prices, setPrices] = useState<Map<string, number>>(new Map());
  const [changes, setChanges] = useState<Map<string, number>>(new Map());
  const [ratios, setRatios] = useState<Map<string, number>>(new Map());
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const tickersRef = useRef<string[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>();

  const loadPositions = useCallback(async () => {
    try {
      const data = await getPortfolio();
      const loaded = data.positions ?? [];
      setPositions(loaded);
      tickersRef.current = loaded.map((p) => p.ticker);
      setCashBalance(data.summary?.cash?.balance ?? null);
      setLoadState("idle");
      return loaded;
    } catch {
      setLoadState("error");
      return [];
    }
  }, []);

  const fetchPrices = useCallback(async (tickers: string[]) => {
    if (tickers.length === 0) return;
    try {
      const query = tickers.join(",");
      const res = await fetch(`/api/quote?tickers=${encodeURIComponent(query)}`);
      if (!res.ok) return;
      const data = (await res.json()) as QuoteResult[];
      if (!Array.isArray(data)) return;
      setPrices((prev) => {
        const next = new Map(prev);
        data.forEach((q) => {
          if (q.price !== null) next.set(q.ticker, q.price);
        });
        return next;
      });
      setChanges((prev) => {
        const next = new Map(prev);
        data.forEach((q) => {
          next.set(q.ticker, q.change ?? 0);
        });
        return next;
      });
    } catch {
      // silently keep previous prices — don't break the component
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const [fetchedPositions] = await Promise.all([
        loadPositions(),
        getCedearRatios().then((r) => {
          if (!cancelled) setRatios(r);
        }).catch(() => {}),
      ]);

      if (cancelled) return;

      await fetchPrices(fetchedPositions.map((p) => p.ticker));

      if (!cancelled) {
        intervalRef.current = setInterval(() => {
          fetchPrices(tickersRef.current);
        }, POLL_INTERVAL_MS);
      }
    }

    void init().catch((err) => console.error("[PnLSidebar] init failed:", err));

    return () => {
      cancelled = true;
      if (intervalRef.current !== undefined) clearInterval(intervalRef.current);
    };
    // reloadKey is a trigger-only dep — not read inside, incremented by retry button
  }, [loadPositions, fetchPrices, reloadKey]);

  if (loadState === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-tv-green/30 border-t-tv-green" />
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
        <p className="text-center text-xs text-tv-text-muted">Error al cargar posiciones</p>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="rounded px-3 py-1.5 text-xs text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const totalPortfolio = positions.reduce((acc, pos) => {
    const livePrice = prices.get(pos.ticker);
    const price = livePrice ?? pos.current_price ?? 0;
    return acc + price * pos.quantity;
  }, 0);

  const dayPnL = calcDayPnL(positions, changes);
  const hasDayPnL = hasDayData(changes);
  const dayPnLPct = calcDayPnLPct(dayPnL, totalPortfolio);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-tv-border px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-tv-text-muted">
          P&amp;L Portfolio
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {positions.length === 0 ? (
          <div className="p-4 text-center text-xs text-tv-text-muted">
            Sin posiciones abiertas
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-tv-border">
            {positions.map((pos) => {
              const livePrice = prices.get(pos.ticker) ?? pos.current_price ?? null;
              const ratio = ratios.get(pos.ticker) ?? 1;
              const displayQty = ratio > 1 ? pos.quantity / ratio : pos.quantity;
              const isCedear = ratio > 1;

              const pnlUSD =
                livePrice !== null
                  ? (livePrice - pos.avg_cost) * pos.quantity
                  : null;
              const pnlPct =
                livePrice !== null && pos.avg_cost > 0
                  ? ((livePrice - pos.avg_cost) / pos.avg_cost) * 100
                  : null;

              const isPositive = pnlUSD !== null && pnlUSD > 0;
              const isNegative = pnlUSD !== null && pnlUSD < 0;

              return (
                <div
                  key={pos.id}
                  className="cursor-pointer px-3 py-2.5 hover:bg-tv-panel-hover"
                  onClick={() => { setDataSource("yahoo"); setSymbol(pos.ticker); }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-400 underline-offset-2 hover:underline">
                      {pos.ticker}
                    </span>
                    <span className="text-[10px] text-tv-text-muted">
                      {isCedear
                        ? `${displayQty.toFixed(0)} CEDEARs`
                        : `qty: ${pos.quantity}`}
                    </span>
                  </div>

                  <div className="mt-1 flex items-center justify-between text-[10px] text-tv-text-muted">
                    <span>Entry: {formatUSDCompact(pos.avg_cost)}</span>
                    <span>
                      Now:{" "}
                      {livePrice !== null ? formatUSDCompact(livePrice) : "—"}
                    </span>
                  </div>

                  <div className="mt-1 flex items-center justify-between">
                    <span
                      className={cn(
                        "text-[11px] font-semibold tabular-nums",
                        isPositive && "text-tv-green",
                        isNegative && "text-tv-red",
                        !isPositive && !isNegative && "text-tv-text-muted",
                      )}
                    >
                      {pnlUSD !== null
                        ? `${pnlUSD >= 0 ? "+" : ""}${formatUSDCompact(pnlUSD)}`
                        : "—"}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] tabular-nums",
                        isPositive && "text-tv-green",
                        isNegative && "text-tv-red",
                        !isPositive && !isNegative && "text-tv-text-muted",
                      )}
                    >
                      {pnlPct !== null
                        ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`
                        : "—"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-tv-border px-3 py-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-tv-text-muted">Total</span>
          <span className="font-semibold tabular-nums text-tv-text">
            {formatUSDCompact(totalPortfolio)}
          </span>
        </div>
        {hasDayPnL && (
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-tv-text-muted">Day</span>
            <span
              className={cn(
                "tabular-nums font-semibold",
                dayPnL > 0 ? "text-tv-green" : dayPnL < 0 ? "text-tv-red" : "text-tv-text-muted"
              )}
            >
              {dayPnL >= 0 ? "+" : ""}
              {formatUSDCompact(dayPnL)}
              {dayPnLPct !== null &&
                ` (${dayPnLPct >= 0 ? "+" : ""}${dayPnLPct.toFixed(2)}%)`}
            </span>
          </div>
        )}
        {cashBalance !== null && (
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-tv-text-muted">Cash</span>
            <span className="tabular-nums text-tv-text-muted">
              {formatUSDCompact(cashBalance)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
