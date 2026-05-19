"use client";

import { useState } from "react";
import { Watchlist } from "@/components/trading/watchlist/Watchlist";
import { WatchlistPanel } from "@/components/trading/watchlist/WatchlistPanel";
import { PnLSidebar } from "@/components/trading/sidebar/PnLSidebar";
import { useChartStore } from "@/lib/store/chart-store";
import { useResizable } from "@/hooks/useResizable";
import { cn } from "@/lib/utils";

// ── Pure utility exports (exported for unit testing) ──────────────────────────

/**
 * Returns the watchlist component variant to render based on the data source.
 * "binance" → crypto watchlist (Binance WebSocket).
 * Anything else → multi-watchlist panel (Yahoo/Supabase).
 */
export function getWatchlistComponent(dataSource: string): "binance" | "yahoo" {
  return dataSource === "binance" ? "binance" : "yahoo";
}

// ── Component ──────────────────────────────────────────────────────────────────

type Tab = "pnl" | "watch";

const TABS: { id: Tab; label: string }[] = [
  { id: "pnl", label: "P&L" },
  { id: "watch", label: "Watch" },
];

export function RightSidebar() {
  const [activeTab, setActiveTab] = useState<Tab>("pnl");
  const dataSource = useChartStore((s) => s.dataSource);
  const { width, handleProps } = useResizable({
    min: 192,
    max: 384,
    default: 256,
    storageKey: "warren:sidebar-width",
  });

  return (
    <div className="relative flex flex-row h-full">
      {/* drag handle — 12px hit area, 1px visual */}
      <div
        className="relative w-3 cursor-col-resize self-stretch flex-shrink-0 group"
        {...handleProps}
      >
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent group-hover:bg-tv-border transition-colors" />
      </div>
      <aside
        className="flex flex-col border-l border-tv-border bg-tv-panel flex-shrink-0"
        style={{ width }}
      >
        <div className="flex border-b border-tv-border">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex-1 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider transition-colors",
                activeTab === tab.id
                  ? "border-b-2 border-tv-green text-tv-text"
                  : "text-tv-text-muted hover:text-tv-text",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1">
          {activeTab === "pnl" ? (
            <PnLSidebar />
          ) : getWatchlistComponent(dataSource) === "binance" ? (
            <Watchlist />
          ) : (
            <WatchlistPanel />
          )}
        </div>
      </aside>
    </div>
  );
}
