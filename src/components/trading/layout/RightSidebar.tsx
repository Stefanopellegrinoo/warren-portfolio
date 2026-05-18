"use client";

import { useState } from "react";
import { Watchlist } from "@/components/trading/watchlist/Watchlist";
import { PnLSidebar } from "@/components/trading/sidebar/PnLSidebar";
import { cn } from "@/lib/utils";

type Tab = "pnl" | "watch";

const TABS: { id: Tab; label: string }[] = [
  { id: "pnl", label: "P&L" },
  { id: "watch", label: "Watch" },
];

export function RightSidebar() {
  const [activeTab, setActiveTab] = useState<Tab>("pnl");

  return (
    <aside className="flex w-64 flex-col border-l border-tv-border bg-tv-panel">
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
        {activeTab === "pnl" ? <PnLSidebar /> : <Watchlist />}
      </div>
    </aside>
  );
}
