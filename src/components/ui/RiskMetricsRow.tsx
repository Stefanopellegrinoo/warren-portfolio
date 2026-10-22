'use client'

import KpiCard, { type FigureTone } from '@/components/ui/KpiCard'
import { SectionHead } from '@/components/resumen/ui'
import { formatNumber, formatPct } from '@/lib/utils'

/**
 * The risk metrics of the whole-portfolio tab: stocks, ONs and cash, the same
 * universe the chart above it draws (S9 of odd/tasks/nucleo-ledger.md). The
 * scope line below the figures says so.
 *
 * A null metric is rendered as "Sin datos suficientes", never as 0: below the
 * A3 interval thresholds the API returns null precisely because a number
 * there would be noise wearing a number's clothes.
 */

/** Structural subset of the statistics payload this row consumes. */
export interface RiskMetricsData {
  sharpeRatio: number | null
  annualizedVol: number | null
  maxDrawdown: number | null
  returnIntervals?: number
  drawdownIntervalsSkipped?: number
}

export const sharpeTone = (s: number): FigureTone => (s >= 1 ? 'ok' : s >= 0 ? 'warn' : 'danger')
export const drawdownTone = (d: number): FigureTone => (d < -0.1 ? 'danger' : 'neutral')

/** A metric that may be missing: "—" plus the reason, never a fake 0. */
export function Metric({ label, value, tone, children }: {
  label: string
  value: string | null
  tone?: FigureTone
  children?: React.ReactNode
}) {
  return value === null
    ? <KpiCard label={label} value="—" tone="muted">Sin datos suficientes</KpiCard>
    : <KpiCard label={label} value={value} tone={tone}>{children}</KpiCard>
}

export function SharpeMetric({ data }: { data: RiskMetricsData }) {
  const s = data.sharpeRatio
  return (
    <Metric label="Ratio de Sharpe" value={s == null ? null : formatNumber(s)} tone={s == null ? undefined : sharpeTone(s)}>
      Anualizado · {data.returnIntervals ?? 0} retornos diarios
    </Metric>
  )
}

export function VolatilityMetric({ data }: { data: RiskMetricsData }) {
  const v = data.annualizedVol
  return (
    <Metric label="Volatilidad anual" value={v == null ? null : formatPct(v, { digits: 1, sign: false })}>
      Anualizada · {data.returnIntervals ?? 0} retornos diarios
    </Metric>
  )
}

export function DrawdownMetric({ data }: { data: RiskMetricsData }) {
  const d = data.maxDrawdown
  return (
    <Metric label="Caída máxima" value={d == null ? null : formatPct(d, { digits: 1, sign: false })} tone={d == null ? undefined : drawdownTone(d)}>
      Desde el pico más alto
      {(data.drawdownIntervalsSkipped ?? 0) > 0 && (
        <span className="block text-warn">{data.drawdownIntervalsSkipped} intervalos omitidos</span>
      )}
    </Metric>
  )
}

export default function RiskMetricsRow({ data }: { data: RiskMetricsData | null }) {
  // Tolerant fetch: a failed metrics request loses the row, not the page.
  if (!data) return null

  return (
    <section aria-labelledby="h-riesgo">
      <SectionHead id="h-riesgo" title="Riesgo" />
      <dl className="grid grid-cols-3 gap-x-6 gap-y-5 pt-4 max-[819px]:grid-cols-2">
        <SharpeMetric data={data} />
        <VolatilityMetric data={data} />
        <DrawdownMetric data={data} />
      </dl>
      <p className="mt-4 text-[13px] text-ink-3">Calculado sobre toda la cartera: acciones, ONs y caja.</p>
    </section>
  )
}
