"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Header } from "@/components/trading/layout/Header";
import { RightSidebar } from "@/components/trading/layout/RightSidebar";
import { BottomPanel } from "@/components/trading/layout/BottomPanel";
import { TradingChart } from "@/components/trading/chart/TradingChart";
import { IndicatorSettingsDialog } from "@/components/trading/chart/IndicatorSettingsDialog";
import { Watchlist } from "@/components/trading/watchlist/Watchlist";
import { useChartStore } from "@/lib/store/chart-store";
import { getProviderForSymbol } from "@/lib/market-data/resolver";
import { coerceTimeframe } from "@/lib/chart/timeframes";
import { TrendingUp, Star } from "lucide-react";
import { cn } from "@/lib/utils";

// Opens the chart on ?symbol=X (links from the summary and the asset search).
function SymbolFromQuery() {
  const requested = useSearchParams().get("symbol");
  const setSymbol = useChartStore((s) => s.setSymbol);
  useEffect(() => {
    if (requested) setSymbol(requested.toUpperCase());
  }, [requested, setSymbol]);
  return null;
}

export default function TradingPage() {
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = coerceTimeframe(useChartStore((s) => s.timeframe), getProviderForSymbol(symbol));
  const setSymbol = useChartStore((s) => s.setSymbol);
  const [mobileView, setMobileView] = useState<'chart' | 'watchlist'>('chart');

  const handleMobileSymbolSelect = (ticker: string) => {
    setSymbol(ticker);
    setMobileView('chart');
  };

  return (
    <>
      <Suspense fallback={null}>
        <SymbolFromQuery />
      </Suspense>

      {/* Main Container: Full screen, no desktop margins */}
      <div className="flex h-[100dvh] flex-col w-full">
        <Header onSymbolSelect={() => setMobileView('chart')} />
        
        {/* Mobile View Switcher (Tabs at top) */}
        <div className="flex h-10 border-b border-tv-border bg-tv-panel md:hidden">
          <button
            onClick={() => setMobileView('chart')}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-colors",
              mobileView === 'chart' ? "text-tv-green border-b-2 border-tv-green" : "text-tv-text-muted"
            )}
          >
            <TrendingUp className="h-3.5 w-3.5" />
            Gráfico
          </button>
          <button
            onClick={() => setMobileView('watchlist')}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-colors",
              mobileView === 'watchlist' ? "text-tv-green border-b-2 border-tv-green" : "text-tv-text-muted"
            )}
          >
            <Star className="h-3.5 w-3.5" />
            Watchlist
          </button>
        </div>

        {/* Content Area */}
        <main className="min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full w-full">
            {/* One chart instance: on phones the watchlist tab hides it, it never mounts twice. */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className={cn("flex min-h-0 flex-1 flex-col", mobileView === 'watchlist' && "max-md:hidden")}>
                <TradingChart symbol={symbol} timeframe={timeframe} />
              </div>
              {mobileView === 'watchlist' && (
                <div className="min-h-0 flex-1 overflow-y-auto bg-tv-bg md:hidden">
                  <Watchlist onSelectSymbol={handleMobileSymbolSelect} />
                </div>
              )}
            </div>

            {/* Desktop Right Sidebar */}
            <div className="hidden md:block flex-shrink-0">
              <RightSidebar />
            </div>
          </div>
        </main>

        {/* Desktop Bottom Components */}
        <div className="hidden md:block">
          <BottomPanel />
        </div>
        <IndicatorSettingsDialog />
      </div>
    </>
  );
}
