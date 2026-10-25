"use client";

import { CandlestickChart, List } from "lucide-react";
import { TimeframePicker } from "@/components/trading/chart/TimeframeSelector";
import { IndicatorMenu } from "@/components/trading/chart/IndicatorMenu";
import { barButton } from "@/components/trading/ui";
import { cn } from "@/lib/utils";
import type { View } from "./Header";

/**
 * The phone's tool bar under the chart, in thumb reach (odd/tasks/grafico-espacio.md S3). The
 * drawing controls belong to the chart, which draws them into `drawingSlot`. The list view only
 * needs the way back.
 */
export function PhoneBar({ view, onViewChange, drawingSlot }: {
  view: View;
  onViewChange: (v: View) => void;
  drawingSlot: (el: HTMLDivElement | null) => void;
}) {
  const chart = view === "chart";
  const Icon = chart ? List : CandlestickChart;

  return (
    <div role="toolbar" aria-label="Herramientas del gráfico" data-phone-bar className="relative flex shrink-0 border-t border-line bg-surface px-1 pb-[env(safe-area-inset-bottom)] min-[820px]:hidden">
      {chart && <TimeframePicker className={barButton} />}
      <div ref={drawingSlot} className={cn("flex flex-[2]", !chart && "hidden")} />
      {chart && <IndicatorMenu stacked />}
      <button type="button" className={barButton} onClick={() => onViewChange(chart ? "list" : "chart")}>
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
        {chart ? "Lista" : "Gráfico"}
      </button>
    </div>
  );
}
