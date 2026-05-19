"use client";

import { useState } from "react";
import { Header } from "@/components/trading/layout/Header";
import { LeftSidebar } from "@/components/trading/layout/LeftSidebar";
import { RightSidebar, getWatchlistComponent } from "@/components/trading/layout/RightSidebar";
import { BottomPanel } from "@/components/trading/layout/BottomPanel";
import { PriceChart } from "@/components/trading/chart/PriceChart";
import { IndicatorSettingsDialog } from "@/components/trading/chart/IndicatorSettingsDialog";
import MobileBottomNav from "@/components/trading/layout/MobileBottomNav";
import { Watchlist } from "@/components/trading/watchlist/Watchlist";
import { WatchlistPanel } from "@/components/trading/watchlist/WatchlistPanel";
import { useChartStore } from "@/lib/store/chart-store";

export default function TradingPage() {
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const dataSource = useChartStore((s) => s.dataSource);
  const setSymbol = useChartStore((s) => s.setSymbol);
  const [mobileView, setMobileView] = useState<'chart' | 'watchlist'>('chart');

  const handleMobileSymbolSelect = (ticker: string) => {
    setSymbol(ticker);
    setMobileView('chart');
  };

  return (
    <>
      {/* Mobile layout */}
      <div className="flex h-[100dvh] flex-col md:hidden">
        <Header />
        <main className="min-h-0 flex-1 overflow-hidden">
          {mobileView === 'chart' ? (
            <PriceChart symbol={symbol} timeframe={timeframe} />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {getWatchlistComponent(dataSource) === 'binance'
                ? <Watchlist onSelectSymbol={handleMobileSymbolSelect} />
                : <WatchlistPanel onSelectSymbol={handleMobileSymbolSelect} />}
            </div>
          )}
        </main>
        <MobileBottomNav activeView={mobileView} onViewChange={setMobileView} />
      </div>

      {/* Desktop layout — unchanged */}
      <div className="hidden md:flex h-full w-full flex-col overflow-hidden">
        <Header />
        <div className="flex min-h-0 flex-1">
          <LeftSidebar />
          <main className="relative flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <PriceChart symbol={symbol} timeframe={timeframe} />
            </div>
          </main>
          <RightSidebar />
        </div>
        <BottomPanel />
        <IndicatorSettingsDialog />
      </div>
    </>
  );
}
