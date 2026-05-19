"use client";

import { useEffect, useState, useCallback } from "react";
import { X, RefreshCw } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { WatchlistItem } from "@/app/api/watchlist/route";

// ── Pure utility exports (exported for unit testing) ──────────────────────────

/**
 * Format a price value for display.
 * Returns "—" for null or zero values.
 */
export function formatWatchlistPrice(price: number | null): string {
  if (price === null || price === 0) return "—";
  return `$${price.toFixed(2)}`;
}

/**
 * Format a percent change value with sign prefix.
 * Returns "—" for null values.
 */
export function formatWatchlistChange(pct: number | null): string {
  if (pct === null) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

/**
 * Returns the Tailwind color class for a change percent value.
 * Positive → green, negative → red, null → muted.
 */
export function getChangeColorClass(pct: number | null): string {
  if (pct === null) return "text-tv-text-muted";
  return pct >= 0 ? "text-tv-green" : "text-tv-red";
}

/**
 * Build the DELETE URL for removing a symbol from the watchlist.
 */
export function buildDeleteUrl(symbol: string): string {
  return `/api/watchlist?symbol=${encodeURIComponent(symbol)}`;
}

// ── Component ──────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 60_000;

export function WatchlistPanel() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWatchlist = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.watchlist ?? []);
    } catch {
      // silently ignore network errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWatchlist();
    const interval = setInterval(fetchWatchlist, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchWatchlist]);

  async function handleDelete(symbol: string) {
    try {
      const res = await fetch(buildDeleteUrl(symbol), { method: "DELETE" });
      if (res.ok) {
        setItems((prev) => prev.filter((item) => item.symbol !== symbol));
      }
    } catch {
      // silently ignore
    }
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-tv-border px-3 py-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-tv-text-muted">
            Watchlist
          </h2>
        </div>
        <div className="flex flex-1 flex-col gap-2 p-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-7 animate-pulse rounded bg-tv-panel-hover"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-tv-border px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-tv-text-muted">
          Watchlist
        </h2>
        <button
          onClick={fetchWatchlist}
          className="rounded p-1 text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
          title="Refresh watchlist"
          aria-label="Refresh watchlist"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-tv-text-muted">
          No symbols in watchlist yet
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="flex flex-col">
            {items.map((item) => (
              <div
                key={item.id}
                className="group grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-tv-border px-3 py-1.5 text-xs"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-tv-text">{item.symbol}</span>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="tabular-nums text-tv-text">
                    {formatWatchlistPrice(item.price)}
                  </span>
                  <span className={cn("tabular-nums text-[10px]", getChangeColorClass(item.changePercent))}>
                    {formatWatchlistChange(item.changePercent)}
                  </span>
                </div>
                <button
                  onClick={() => handleDelete(item.symbol)}
                  className="invisible rounded p-0.5 text-tv-text-muted hover:bg-tv-bg hover:text-tv-red group-hover:visible"
                  aria-label={`Remove ${item.symbol} from watchlist`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
