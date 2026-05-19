"use client";

import { useChartStore } from "@/lib/store/chart-store";
import type { Timeframe } from "@/lib/binance/types";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";

const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];

export function TimeframeSelector() {
  const tf = useChartStore((s) => s.timeframe);
  const setTf = useChartStore((s) => s.setTimeframe);

  return (
    <>
      {/* Desktop version: horizontal pills */}
      <div className="hidden sm:flex items-center gap-0.5 rounded bg-tv-bg p-0.5">
        {TIMEFRAMES.map((t) => (
          <button
            key={t}
            onClick={() => setTf(t)}
            className={cn(
              "rounded px-2 py-1 text-xs font-medium uppercase transition-colors",
              tf === t
                ? "bg-tv-panel-hover text-tv-text"
                : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Mobile version: dropdown */}
      <div className="flex sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1 rounded bg-tv-bg px-2 py-1.5 text-xs font-medium uppercase text-tv-text hover:bg-tv-panel-hover outline-none">
            {tf}
            <ChevronDown className="h-3 w-3 text-tv-text-muted" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="bg-tv-panel border-tv-border min-w-[80px]">
            {TIMEFRAMES.map((t) => (
              <DropdownMenuItem
                key={t}
                onClick={() => setTf(t)}
                className={cn(
                  "text-xs uppercase focus:bg-tv-panel-hover focus:text-tv-text",
                  tf === t ? "bg-tv-panel-hover text-tv-text" : "text-tv-text-muted"
                )}
              >
                {t}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
