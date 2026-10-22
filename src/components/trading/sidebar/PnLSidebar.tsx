"use client";

import { useEffect, useState } from "react";
import type { Position } from "@/types";
import { getPortfolio, getCedearRatios } from "@/lib/warren/positions";
import { useChartStore } from "@/lib/store/chart-store";
import { Chip, SectionHead, toneOf, linkButton } from "@/components/resumen/ui";
import { formatNumber, formatPct, formatUSD } from "@/lib/utils";

// ── Pure utility exports (exported for unit testing) ──────────────────────────

/**
 * Computes daily P&L as sum of (change * quantity) across all positions.
 */
export function calcDayPnL(
  positions: Position[],
  changes: Map<string, number>
): number {
  return positions.reduce(
    (acc, p) => acc + (changes.get(p.ticker) ?? 0) * p.quantity,
    0
  );
}

/**
 * Returns true when at least one ticker in the changes map has a non-zero value.
 */
export function hasDayData(changes: Map<string, number>): boolean {
  if (changes.size === 0) return false;
  return [...changes.values()].some((v) => v !== 0);
}

/**
 * Computes daily P&L percentage.
 * Returns null when totalPortfolio - dayPnL === 0 to avoid division by zero.
 */
export function calcDayPnLPct(
  dayPnL: number,
  totalPortfolio: number
): number | null {
  const base = totalPortfolio - dayPnL;
  if (base === 0) return null;
  return (dayPnL / base) * 100;
}

type LoadState = "loading" | "idle" | "error";

const signedUSD = (n: number) => (n > 0 ? "+" : "") + formatUSD(n);
const qtyText = (n: number) => formatNumber(n, { decimals: Number.isInteger(n) ? 0 : 4 });

/** The user's position in the chart's symbol. Prices come from the page's single quote poll. */
export function PnLSidebar({ price }: { price: number | null }) {
  const symbol = useChartStore((s) => s.symbol);
  const [positions, setPositions] = useState<Position[]>([]);
  const [ratios, setRatios] = useState<Map<string, number>>(new Map());
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    Promise.all([getPortfolio(), getCedearRatios().catch(() => new Map<string, number>())])
      .then(([data, r]) => {
        if (cancelled) return;
        setPositions(data.positions ?? []);
        setRatios(r);
        setLoadState("idle");
      })
      .catch(() => { if (!cancelled) setLoadState("error"); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const pos = positions.find((p) => p.ticker === symbol);

  return (
    <section aria-labelledby="h-posicion" className="border-t border-line px-4 pb-4 pt-3">
      <SectionHead id="h-posicion" title="Tu posición" />
      {loadState === "loading" && <p role="status" className="pt-3 text-[13px] text-ink-3">Cargando…</p>}
      {loadState === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 pt-3 text-[13px]">
          <span className="text-danger">No se pudieron cargar tus posiciones</span>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className={linkButton}>Reintentar</button>
        </div>
      )}
      {loadState === "idle" && !pos && <p className="pt-3 text-[13px] text-ink-3">No tenés {symbol} en tu cartera.</p>}
      {loadState === "idle" && pos && <PositionRows pos={pos} ratio={ratios.get(pos.ticker) ?? 1} price={price ?? pos.current_price ?? null} />}
    </section>
  );
}

function PositionRows({ pos, ratio, price }: { pos: Position; ratio: number; price: number | null }) {
  const pnl = price !== null ? (price - pos.avg_cost) * pos.quantity : null;
  const pnlPct = price !== null && pos.avg_cost > 0 ? (price - pos.avg_cost) / pos.avg_cost : null;
  const rows: [string, React.ReactNode][] = [
    ["Cantidad", ratio > 1 ? `${formatNumber(pos.quantity / ratio, { decimals: 0 })} CEDEARs` : qtyText(pos.quantity)],
    ["Costo promedio", formatUSD(pos.avg_cost)],
    ["Precio", price !== null ? formatUSD(price) : "—"],
  ];

  return (
    <dl className="text-[13px] tabular-nums">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-3 border-b border-line py-2">
          <dt className="text-ink-3">{label}</dt>
          <dd className="text-ink">{value}</dd>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 pt-2">
        <dt className="text-ink-3">Resultado</dt>
        <dd className="flex items-center gap-2">
          <span className="font-medium text-ink">{pnl !== null ? signedUSD(pnl) : "—"}</span>
          {pnlPct !== null && <Chip tone={toneOf(pnlPct)}>{formatPct(pnlPct)}</Chip>}
        </dd>
      </div>
    </dl>
  );
}
