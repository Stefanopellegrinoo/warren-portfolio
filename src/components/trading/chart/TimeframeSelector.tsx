"use client";

import { useChartStore } from "@/lib/store/chart-store";
import { getProviderForSymbol } from "@/lib/market-data/resolver";
import { coerceTimeframe, timeframesFor } from "@/lib/chart/timeframes";
import type { Timeframe } from "@/lib/binance/types";
import { cn } from "@/lib/utils";

const LABELS: Partial<Record<Timeframe, string>> = { "1d": "1D", "1w": "1S", "1M": "1M" };
const NAMES: Partial<Record<Timeframe, string>> = {
  "1m": "1 minuto", "5m": "5 minutos", "15m": "15 minutos", "1h": "1 hora", "4h": "4 horas",
  "1d": "Diario", "1w": "Semanal", "1M": "Mensual",
};

/** Only the timeframes the symbol's source really serves. */
export function TimeframeSelector() {
  const symbol = useChartStore((s) => s.symbol);
  const stored = useChartStore((s) => s.timeframe);
  const setTf = useChartStore((s) => s.setTimeframe);
  const source = getProviderForSymbol(symbol);
  const tf = coerceTimeframe(stored, source);

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
          onClick={() => setTf(t)}
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
