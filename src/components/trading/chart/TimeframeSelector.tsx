"use client";

import { useState } from "react";
import { useChartStore } from "@/lib/store/chart-store";
import { getProviderForSymbol } from "@/lib/market-data/resolver";
import { coerceTimeframe, timeframesFor } from "@/lib/chart/timeframes";
import type { Timeframe } from "@/lib/binance/types";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const LABELS: Partial<Record<Timeframe, string>> = { "1d": "1D", "1w": "1S", "1M": "1M" };
const NAMES: Partial<Record<Timeframe, string>> = {
  "1m": "1 minuto", "5m": "5 minutos", "15m": "15 minutos", "1h": "1 hora", "4h": "4 horas",
  "1d": "Diario", "1w": "Semanal", "1M": "Mensual",
};

function useTimeframe() {
  const source = getProviderForSymbol(useChartStore((s) => s.symbol));
  return { source, tf: coerceTimeframe(useChartStore((s) => s.timeframe), source), setTf: useChartStore((s) => s.setTimeframe) };
}

/** Only the timeframes the symbol's source really serves. */
export function TimeframeSelector({ onPick }: { onPick?: () => void }) {
  const { source, tf, setTf } = useTimeframe();

  return (
    <div role="radiogroup" aria-label="Temporalidad" className="flex shrink-0 items-center gap-0.5 rounded bg-surface-2 p-0.5">
      {timeframesFor(source).map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={tf === t}
          aria-label={NAMES[t]}
          title={NAMES[t]}
          onClick={() => {
            setTf(t);
            onPick?.();
          }}
          className={cn(
            "inline-flex min-h-8 items-center rounded px-2.5 text-[13px] tabular-nums text-ink-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring max-[819px]:min-h-11 max-[819px]:px-2",
            tf === t && "bg-surface text-ink shadow-[0_0_0_1px_var(--line)]",
          )}
        >
          {LABELS[t] ?? t}
        </button>
      ))}
    </div>
  );
}

/** The phone's bottom bar button (odd/tasks/grafico-espacio.md S3): the current timeframe,
 *  and the ones to pick from above it. */
export function TimeframePicker({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  const { tf } = useTimeframe();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={className}>
        <span className="text-[15px] font-medium leading-[18px] tabular-nums text-ink">{LABELS[tf] ?? tf}</span>
        Intervalo
      </PopoverTrigger>
      <PopoverContent side="top" className="w-auto min-w-0">
        <TimeframeSelector onPick={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
