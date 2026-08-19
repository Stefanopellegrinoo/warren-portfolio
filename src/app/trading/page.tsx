"use client";

import { useState } from "react";
import { Header } from "@/components/trading/layout/Header";
import { LeftSidebar } from "@/components/trading/layout/LeftSidebar";
import { RightSidebar } from "@/components/trading/layout/RightSidebar";
import { BottomPanel } from "@/components/trading/layout/BottomPanel";
import { PriceChart } from "@/components/trading/chart/PriceChart";
import { IndicatorSettingsDialog } from "@/components/trading/chart/IndicatorSettingsDialog";
import { Watchlist } from "@/components/trading/watchlist/Watchlist";
import { useChartStore } from "@/lib/store/chart-store";
import Sidebar from "@/components/layout/Sidebar";
import { TrendingUp, Star } from "lucide-react";
import { cn } from "@/lib/utils";

export default function TradingPage() {
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const setSymbol = useChartStore((s) => s.setSymbol);
  const [mobileView, setMobileView] = useState<'chart' | 'watchlist'>('chart');

  const handleMobileSymbolSelect = (ticker: string) => {
    setSymbol(ticker);
    setMobileView('chart');
  };

  return (
    <>
      {/* Sidebar ONLY for Mobile (includes bottom nav) */}
      <div className="md:hidden">
        <Sidebar />
      </div>

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
        <main className="min-h-0 flex-1 overflow-hidden pb-14 md:pb-0">
          <div className="flex h-full w-full">
            {/* Desktop Left Sidebar */}
            <div className="hidden md:block">
              <LeftSidebar />
            </div>

            {/* Middle Content */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {/* Mobile Logic */}
              <div className="flex h-full flex-col md:hidden">
                {mobileView === 'chart' ? (
                  <PriceChart symbol={symbol} timeframe={timeframe} />
                ) : (
                  <div className="min-h-0 flex-1 overflow-y-auto bg-tv-bg">
                    <Watchlist onSelectSymbol={handleMobileSymbolSelect} />
                  </div>
                )}
              </div>

              {/* Desktop Logic */}
              <div className="hidden h-full md:block">
                <PriceChart symbol={symbol} timeframe={timeframe} />
              </div>
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
