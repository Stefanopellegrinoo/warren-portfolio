"use client";

import { Watchlist } from "@/components/trading/watchlist/Watchlist";
import { PnLSidebar } from "@/components/trading/sidebar/PnLSidebar";
import { cn } from "@/lib/utils";

interface RightSidebarProps {
  /** Live price of the chart's symbol, shared with the top bar. */
  price: number | null;
  onSelectSymbol?: (ticker: string) => void;
  className?: string;
}

/** Watchlist, then the position in the chart's symbol. Full width when it replaces the chart on narrow screens. */
export function RightSidebar({ price, onSelectSymbol, className }: RightSidebarProps) {
  return (
    <aside
      aria-label="Lista y posición"
      className={cn("flex min-h-0 w-[280px] flex-none flex-col border-l border-line bg-canvas max-[1099px]:w-full max-[1099px]:border-l-0", className)}
    >
      <div className="min-h-0 flex-1">
        <Watchlist onSelectSymbol={onSelectSymbol} />
      </div>
      <PnLSidebar price={price} />
    </aside>
  );
}
