"use client";

import { Activity, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChartStore, type IndicatorKey, type IndicatorConfig } from "@/lib/store/chart-store";
import { barButton } from "@/components/trading/ui";
import { effectiveConfig } from "@/lib/chart/indicator-style";
import { useChartPreferences } from "./useChartPreferences";

interface Entry {
  key: IndicatorKey;
  label: (cfg: IndicatorConfig) => string;
  group: string;
}

const ENTRIES: Entry[] = [
  { key: "ema20",      group: "Medias móviles", label: (c) => `EMA ${c.ema20}` },
  { key: "ema50",      group: "Medias móviles", label: (c) => `EMA ${c.ema50}` },
  { key: "ema200",     group: "Medias móviles", label: (c) => `EMA ${c.ema200}` },
  { key: "bollinger",  group: "Medias móviles", label: (c) => `Bollinger Bands (${c.bbPeriod}, ${c.bbStdDev})` },
  { key: "volume",     group: "Volumen",         label: () => "Volumen" },
  { key: "obv",        group: "Volumen",         label: () => "OBV" },
  { key: "rsi",        group: "Osciladores",     label: (c) => `RSI (${c.rsi})` },
  { key: "stochastic", group: "Osciladores",     label: (c) => `Stochastic (${c.stochK}, ${c.stochSmooth}, ${c.stochD})` },
  { key: "macd",       group: "Osciladores",     label: (c) => `MACD (${c.macdFast}, ${c.macdSlow}, ${c.macdSignal})` },
  { key: "adx",        group: "Tendencia",        label: (c) => `ADX (${c.adxPeriod})` },
];

/** `stacked`: the phone's bottom bar button, its name under the icon and the menu above it. */
export function IndicatorMenu({ stacked = false }: { stacked?: boolean }) {
  const indicators = useChartStore((s) => s.indicators);
  // Named by the values the chart uses: an indicator's settings saved in the account win (S4).
  const device = useChartStore((s) => s.config);
  const config = effectiveConfig(device, useChartPreferences().preferences.indicatorSettings);
  const toggle = useChartStore((s) => s.toggleIndicator);

  const groups = ENTRIES.reduce<Record<string, Entry[]>>((acc, i) => {
    (acc[i.group] ||= []).push(i);
    return acc;
  }, {});

  const activeCount = Object.values(indicators).filter(Boolean).length;

  return (
    <DropdownMenu>
      {stacked ? (
        <DropdownMenuTrigger aria-label="Indicadores" className={barButton}>
          <span className="relative">
            <Activity className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
            {activeCount > 0 && (
              <span className="absolute -right-3.5 -top-1.5 rounded bg-surface-2 px-1 text-[10px] font-medium leading-[14px] tabular-nums text-ink-2">
                {activeCount}
              </span>
            )}
          </span>
          Indicadores
        </DropdownMenuTrigger>
      ) : (
        <DropdownMenuTrigger aria-label="Indicadores" className="flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2 max-[819px]:min-w-11 text-[13px] text-ink-2 hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring max-[819px]:min-h-11">
          <Activity className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          <span className="max-[819px]:hidden">Indicadores</span>
          {activeCount > 0 && (
            <span className="rounded bg-surface-2 px-1.5 text-xs font-medium tabular-nums text-ink-2 max-[819px]:hidden">
              {activeCount}
            </span>
          )}
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent side={stacked ? "top" : "bottom"} align={stacked ? "end" : "start"} className="w-64 max-w-[calc(100vw-32px)] rounded-lg border border-line bg-surface p-1 text-ink shadow-pop ring-0">
        {Object.entries(groups).map(([group, items], idx) => (
          <DropdownMenuGroup key={group}>
            {idx > 0 && <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-line" />}
            <DropdownMenuLabel className="px-2 pb-1 pt-2 text-xs font-medium text-ink-3">
              {group}
            </DropdownMenuLabel>
            {items.map((i) => (
              <DropdownMenuItem
                key={i.key}
                closeOnClick={false}
                onClick={() => toggle(i.key)}
                className="flex min-h-8 cursor-pointer items-center justify-between rounded px-2 text-[13px] text-ink outline-none focus:bg-hover focus:text-ink data-[highlighted]:bg-hover max-[819px]:min-h-11"
              >
                <span>{i.label(config)}</span>
                {indicators[i.key] && <Check className="h-4 w-4 text-accent" strokeWidth={1.5} aria-label="Activo" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
