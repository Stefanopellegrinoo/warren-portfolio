"use client";

import { Header } from "@/components/trading/layout/Header";
import { LeftSidebar } from "@/components/trading/layout/LeftSidebar";
import { RightSidebar } from "@/components/trading/layout/RightSidebar";
import { BottomPanel } from "@/components/trading/layout/BottomPanel";
import { PriceChart } from "@/components/trading/chart/PriceChart";
import { IndicatorSettingsDialog } from "@/components/trading/chart/IndicatorSettingsDialog";
import { useChartStore } from "@/lib/store/chart-store";

export default function TradingPage() {
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
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
  );
}
