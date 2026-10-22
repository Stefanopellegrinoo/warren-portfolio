"use client";

import { Star } from "lucide-react";
import { SymbolSelector } from "@/components/trading/chart/SymbolSelector";
import { TimeframeSelector } from "@/components/trading/chart/TimeframeSelector";
import { IndicatorMenu } from "@/components/trading/chart/IndicatorMenu";
import { Chip, toneOf } from "@/components/resumen/ui";
import { useChartStore } from "@/lib/store/chart-store";
import { addSymbolToCurrentWatchlist } from "@/lib/warren/watchlist";
import { cn, formatPct } from "@/lib/utils";
import { iconButton, priceText } from "@/components/trading/ui";
import type { Quote } from "./useQuote";

export type View = "chart" | "list";

const VIEWS: { id: View; label: string }[] = [
  { id: "chart", label: "Gráfico" },
  { id: "list", label: "Lista" },
];

interface HeaderProps {
  view: View;
  onViewChange: (v: View) => void;
  quote: Quote | null;
}

/** The chart's top bar: symbol and quote, timeframe, indicators and the watchlist star. */
export function Header({ view, onViewChange, quote }: HeaderProps) {
  const symbol = useChartStore((s) => s.symbol);

  return (
    <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-canvas px-3 py-1.5 max-[819px]:gap-x-1 max-[819px]:px-2">
      <div className="flex min-w-0 items-center max-[1099px]:order-1 max-[1099px]:flex-1">
        <SymbolSelector onSymbolSelect={() => onViewChange("chart")}>
          {quote && (
            <>
              <span className="truncate font-normal tabular-nums text-ink-2">{priceText(quote.price)}</span>
              <Chip tone={toneOf(quote.changePct)}>{formatPct(quote.changePct)}</Chip>
            </>
          )}
        </SymbolSelector>
      </div>

      <div className={cn("min-w-0 overflow-x-auto max-[1099px]:order-5 max-[819px]:flex-1 [&>div]:w-fit", view === "list" && "max-[1099px]:hidden")}>
        <TimeframeSelector />
      </div>

      <div className={cn("max-[1099px]:order-3", view === "list" && "max-[1099px]:hidden")}>
        <IndicatorMenu />
      </div>

      <div className="max-[1099px]:order-2">
        <WatchStar symbol={symbol} />
      </div>

      {/* Below 1100 px: symbol, star and indicators on one line; timeframe and view switch on the next. */}
      <div aria-hidden="true" className="h-0 basis-full max-[1099px]:order-4 min-[1100px]:hidden" />

      <div role="radiogroup" aria-label="Vista" className="ml-auto inline-flex flex-none gap-0.5 rounded-md border border-line bg-surface-2 p-0.5 max-[1099px]:order-6 min-[1100px]:hidden">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={view === v.id}
            onClick={() => onViewChange(v.id)}
            className={cn(
              "inline-flex min-h-8 items-center rounded px-3 text-[13px] text-ink-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring max-[819px]:min-h-11 max-[819px]:px-2.5",
              view === v.id && "bg-surface text-ink shadow-[0_0_0_1px_var(--line)]",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>
    </header>
  );
}

function WatchStar({ symbol }: { symbol: string }) {
  const activeId = useChartStore((s) => s.activeWatchlistId);
  const local = useChartStore((s) => s.watchlist);
  // Membership is only known for the local list; a remote list answers on add.
  const inList = !activeId && local.includes(symbol);
  const label = inList ? `${symbol} está en tu lista` : `Agregar ${symbol} a la lista`;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={inList}
      disabled={inList}
      onClick={() => addSymbolToCurrentWatchlist(symbol)}
      className={cn(iconButton, inList && "text-accent hover:bg-transparent hover:text-accent")}
    >
      <Star className={cn("h-4 w-4", inList && "fill-current")} strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}
