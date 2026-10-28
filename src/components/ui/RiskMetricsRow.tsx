'use client'

import KpiCard, { type FigureTone } from '@/components/ui/KpiCard'
import { SectionHead } from '@/components/resumen/ui'
import { formatDate, formatNumber, formatPct } from '@/lib/utils'
import { MIN_INTERVALS_SHARPE, MIN_INTERVALS_VOLATILITY } from '@/lib/asset-universe'

/**
 * The risk metrics of the whole-portfolio tab: stocks, ONs and cash, the same
 * universe the chart above it draws (S9 of odd/tasks/nucleo-ledger.md). The
 * scope line below the figures says so.
 *
 * A null metric is rendered as "—" with its reason, never as 0: below the
 * minimum samples the API returns null precisely because a number there would
 * be noise wearing a number's clothes. The row says what each figure rests on
 * (odd/tasks/statistics-truth.md S4, S5): the measured period, the days left
 * out for negative cash, a degraded series and skipped intervals.
 */

/** Structural subset of the statistics payload this row consumes. */
export interface RiskMetricsData {
  sharpeRatio: number | null
  annualizedVol: number | null
  maxDrawdown: number | null
  returnIntervals?: number
  /** Skipped intervals of the one return series behind the drawdown, the volatility and the Sharpe. */
  drawdownIntervalsSkipped?: number
  /** First day measured, and how many days (S4). */
  measuredFrom?: string | null
  measuredDays?: number
  /** Last day whose recorded cash is negative: up to it nothing is measured (S4). */
  negativeCashUntil?: string | null
  /** 'negative_cash': today's recorded cash is negative, so nothing is measured (S4). */
  unavailableReason?: string | null
  /** Prices missing on some days: valued at cost (S5). */
  degraded?: boolean
}

export const sharpeTone = (s: number): FigureTone => (s >= 1 ? 'ok' : s >= 0 ? 'warn' : 'danger')
export const drawdownTone = (d: number): FigureTone => (d < -0.1 ? 'danger' : 'neutral')

/** A metric that may be missing: "—" plus the reason, never a fake 0. */
export function Metric({ label, value, tone, empty = 'Sin datos suficientes', children }: {
  label: string
  value: string | null
  tone?: FigureTone
  /** Why there is no number. */
  empty?: string
  children?: React.ReactNode
}) {
  return value === null
    ? <KpiCard label={label} value="—" tone="muted">{empty}</KpiCard>
    : <KpiCard label={label} value={value} tone={tone}>{children}</KpiCard>
}

/** Why a figure is missing: deposits, or how many daily returns it still needs. */
function missing(data: RiskMetricsData, need?: number): string {
  if (data.unavailableReason === 'negative_cash') return 'Faltan depósitos'
  const have = data.returnIntervals ?? 0
  return need !== undefined && have < need ? `Sin datos suficientes: necesita ${need} días de mercado, hay ${have}` : 'Sin datos suficientes'
}

function Skipped({ data }: { data: RiskMetricsData }) {
  const n = data.drawdownIntervalsSkipped ?? 0
  return n > 0 ? <span className="block text-warn">{n} intervalos omitidos</span> : null
}

/** What the negative-cash rule left out (S4), in words; null when nothing was. */
export function negativeCashNote(data: Pick<RiskMetricsData, 'negativeCashUntil' | 'unavailableReason'>): string | null {
  if (data.unavailableReason === 'negative_cash') return 'Faltan depósitos: la caja registrada hoy es negativa y toda la cartera no se puede medir.'
  if (data.negativeCashUntil) return `Hasta el ${formatDate(data.negativeCashUntil)} hay días con la caja negativa (faltan depósitos): quedan afuera.`
  return null
}

export function SharpeMetric({ data }: { data: RiskMetricsData }) {
  const s = data.sharpeRatio
  return (
    <Metric label="Ratio de Sharpe" value={s == null ? null : formatNumber(s)} tone={s == null ? undefined : sharpeTone(s)} empty={missing(data, MIN_INTERVALS_SHARPE)}>
      Anualizado, sin tasa libre de riesgo · {data.returnIntervals ?? 0} retornos diarios
      <Skipped data={data} />
    </Metric>
  )
}

export function VolatilityMetric({ data }: { data: RiskMetricsData }) {
  const v = data.annualizedVol
  return (
    <Metric label="Volatilidad anual" value={v == null ? null : formatPct(v, { digits: 1, sign: false })} empty={missing(data, MIN_INTERVALS_VOLATILITY)}>
      Anualizada · {data.returnIntervals ?? 0} retornos diarios
      <Skipped data={data} />
    </Metric>
  )
}

export function DrawdownMetric({ data }: { data: RiskMetricsData }) {
  const d = data.maxDrawdown
  return (
    <Metric label="Caída máxima" value={d == null ? null : formatPct(d, { digits: 1, sign: false })} tone={d == null ? undefined : drawdownTone(d)} empty={missing(data)}>
      Desde el pico más alto
      <Skipped data={data} />
    </Metric>
  )
}

export default function RiskMetricsRow({ data }: { data: RiskMetricsData | null }) {
  // Tolerant fetch: a failed metrics request loses the row, not the page.
  if (!data) return null
  const note = negativeCashNote(data)

  return (
    <section aria-labelledby="h-riesgo">
      <SectionHead id="h-riesgo" title="Riesgo" />
      <dl className="grid grid-cols-3 gap-x-6 gap-y-5 pt-4 max-[819px]:grid-cols-2">
        <SharpeMetric data={data} />
        <VolatilityMetric data={data} />
        <DrawdownMetric data={data} />
      </dl>
      <p className="mt-4 text-[13px] text-ink-3">Calculado sobre toda la cartera: acciones, ONs y caja.</p>
      {data.measuredFrom && (
        <p className="mt-1 text-[13px] text-ink-3">
          Desde el {formatDate(data.measuredFrom)}{data.measuredDays != null && ` · ${data.measuredDays} días de mercado`}
        </p>
      )}
      {note && <p className="mt-1 text-[13px] text-warn">{note}</p>}
      {data.degraded && <p className="mt-1 text-[13px] text-warn">Faltan precios de algunos días: se valuaron al costo.</p>}
    </section>
  )
}
