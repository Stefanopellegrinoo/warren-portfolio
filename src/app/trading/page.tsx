"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Header, type View } from "@/components/trading/layout/Header";
import { RightSidebar } from "@/components/trading/layout/RightSidebar";
import { useQuote } from "@/components/trading/layout/useQuote";
import { TradingChart } from "@/components/trading/chart/TradingChart";
import { IndicatorSettingsDialog } from "@/components/trading/chart/IndicatorSettingsDialog";
import { useChartStore } from "@/lib/store/chart-store";
import { getProviderForSymbol } from "@/lib/market-data/resolver";
import { coerceTimeframe } from "@/lib/chart/timeframes";
import { cn } from "@/lib/utils";

export default function TradingPage() {
  return (
    <Suspense fallback={null}>
      <Trading />
    </Suspense>
  );
}

function Trading() {
  // Opens the chart on ?symbol=X (links from the summary and the asset search). The first render
  // already uses X, before anything subscribes to the store, so the last symbol is never loaded
  // first; a later link to another symbol arrives through the effect.
  const requested = useSearchParams().get("symbol")?.toUpperCase();
  useState(() => {
    if (requested) useChartStore.setState({ symbol: requested });
  });
  const setSymbol = useChartStore((s) => s.setSymbol);
  useEffect(() => {
    if (requested) setSymbol(requested);
  }, [requested, setSymbol]);

  const symbol = useChartStore((s) => s.symbol);
  const timeframe = coerceTimeframe(useChartStore((s) => s.timeframe), getProviderForSymbol(symbol));
  const quote = useQuote(symbol);
  // Below 1100 px the chart and the list share the screen through the Gráfico / Lista switch.
  const [view, setView] = useState<View>("chart");

  return (
    <div className="flex h-dvh flex-col max-[819px]:h-[calc(100dvh-3.5rem)]">
      <h1 className="sr-only">Gráficos</h1>

      <Header view={view} onViewChange={setView} quote={quote} />

      <div className="flex min-h-0 flex-1">
        {/* One chart instance: the list view only hides it, it never mounts twice. */}
        <div data-pane="chart" className={cn("flex min-h-0 min-w-0 flex-1 flex-col", view === "list" && "max-[1099px]:hidden")}>
          <TradingChart symbol={symbol} timeframe={timeframe} />
        </div>
        <RightSidebar
          price={quote?.price ?? null}
          onSelectSymbol={() => setView("chart")}
          className={cn(view === "chart" && "max-[1099px]:hidden")}
        />
      </div>

      <IndicatorSettingsDialog />
    </div>
  );
}
