"use client";

import { useRef } from "react";
import { Watchlist } from "@/components/trading/watchlist/Watchlist";
import { PnLSidebar } from "@/components/trading/sidebar/PnLSidebar";
import { cn } from "@/lib/utils";
import { useResizableWidth } from "./useResizableWidth";

interface RightSidebarProps {
  /** Live price of the chart's symbol, shared with the top bar. */
  price: number | null;
  onSelectSymbol?: (ticker: string) => void;
  className?: string;
}

/**
 * Watchlist, then the position in the chart's symbol. Full width when it replaces the chart on narrow
 * screens; from 1100 px its left edge is dragged to make it wider or narrower (the chart follows by itself).
 * Either way the list shows more the wider it is.
 */
export function RightSidebar({ price, onSelectSymbol, className }: RightSidebarProps) {
  const ref = useRef<HTMLElement>(null);
  const { wide, width, style, separatorProps } = useResizableWidth(ref);

  return (
    <aside
      ref={ref}
      aria-label="Lista y posición"
      style={style}
      className={cn("relative flex min-h-0 w-[280px] flex-none flex-col border-l border-line bg-canvas max-[1099px]:w-full max-[1099px]:border-l-0", className)}
    >
      {wide && (
        <div
          {...separatorProps}
          className="absolute inset-y-0 -left-[5px] z-10 w-[9px] cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-[3px] after:w-[3px] after:rounded-sm after:bg-transparent after:transition-colors after:duration-100 hover:after:bg-accent focus-visible:after:bg-accent data-[dragging=true]:after:bg-accent motion-reduce:after:transition-none"
        />
      )}
      <div className="min-h-0 flex-1">
        <Watchlist onSelectSymbol={onSelectSymbol} width={width} />
      </div>
      <PnLSidebar price={price} />
    </aside>
  );
}
