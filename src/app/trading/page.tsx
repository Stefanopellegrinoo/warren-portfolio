"use client";

import { useState } from "react";
import { Header } from "@/components/trading/layout/Header";
import { LeftSidebar } from "@/components/trading/layout/LeftSidebar";
import { RightSidebar } from "@/components/trading/layout/RightSidebar";
import { BottomPanel } from "@/components/trading/layout/BottomPanel";
import { PriceChart } from "@/components/trading/chart/PriceChart";
import { IndicatorSettingsDialog } from "@/components/trading/chart/IndicatorSettingsDialog";
import MobileBottomNav from "@/components/trading/layout/MobileBottomNav";
import { useChartStore } from "@/lib/store/chart-store";

export default function TradingPage() {
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const [mobileView, setMobileView] = useState<'chart' | 'watchlist'>('chart');

  return (
    <>
      {/* Mobile layout */}
      <div className="flex h-[100dvh] flex-col md:hidden">
        <Header />
        <main className="min-h-0 flex-1 overflow-hidden">
          {mobileView === 'chart' ? (
            <PriceChart symbol={symbol} timeframe={timeframe} />
          ) : (
            <div className="flex h-full items-center justify-center text-tv-text-muted text-sm">
              Watchlist coming in next PR
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
