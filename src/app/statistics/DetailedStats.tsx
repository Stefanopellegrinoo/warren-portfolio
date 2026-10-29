'use client'

import dynamic from 'next/dynamic'
import KpiCard, { toneOfResult } from '@/components/ui/KpiCard'
import { SharpeMetric, VolatilityMetric, DrawdownMetric } from '@/components/ui/RiskMetricsRow'
import ShareList from '@/components/charts/ShareList'
import ChartPlaceholder from '@/components/charts/ChartPlaceholder'
import { signed } from '@/components/charts/tokens'
import { SectionHead } from '@/components/resumen/ui'
import { formatUSD, formatPct, formatNumber } from '@/lib/utils'

export interface StatData {
  /** Null below MIN_INTERVALS_DRAWDOWN — "Sin datos suficientes", never 0. */
  maxDrawdown: number | null
  winRate: number | null
  totalPortfolioValue: number
  unpricedPositions?: number
  /** Which positions are valued at cost for lack of a price. */
  unpricedTickers?: string[]
  allocation: { name: string; value: number; pct: number }[]
  /** Sales plus the class's dividends and coupons, as the dashboard's realized. */
  realizedPnl: number
  /** The dividends (stocks) or coupons (ONs) inside realizedPnl, lifetime. */
  incomeReceived?: number
  openPnl: number
  biggestWinner: { ticker: string; pnl: number; pnl_pct: number; status: string } | null
  biggestLoser: { ticker: string; pnl: number; pnl_pct: number; status: string } | null
  /** One result per asset: open, sales and income. */
  allPnLs: { ticker: string; pnl: number }[]
  /** Sales by calendar month, every month from the first sale to the last. */
  monthlyReturns: { month: string; pnl: number; trades: number }[]
  cumulativePnl: { date: string; ticker: string; pnl: number; cumulative: number }[]
  /** Days from the position's first purchase to the sale; null without sales. */
  avgHoldingDays: number | null
  maxHoldingDays: number | null
  minHoldingDays: number | null
  avgWin: number | null
  avgLoss: number | null
  profitFactor: number | null
  sharpeRatio: number | null
  annualizedVol: number | null
  returnIntervals?: number
  drawdownIntervals?: number
  /** Which asset universe these metrics were computed over. */
  universe?: string
  drawdownIntervalsSkipped?: number
  monthlyStdDev: number | null
  winnersCount: number
  losersCount: number
  totalTrades: number
  /** Value of the shares with a local BCBA ticker (stocks tab: the market split). */
  arsExposure: number
  usdExposure: number
}

// recharts arrives with the charts, not with the page (odd/tasks/rendimiento.md S9); each box keeps its height meanwhile.
// next/dynamic takes its options only as an object literal (the build rejects a variable).
const CumulativeChart = dynamic(() => import('./DetailedCharts').then(m => m.CumulativeChart), { ssr: false, loading: ChartPlaceholder })
const MonthlyChart = dynamic(() => import('./DetailedCharts').then(m => m.MonthlyChart), { ssr: false, loading: ChartPlaceholder })
const AssetChart = dynamic(() => import('./DetailedCharts').then(m => m.AssetChart), { ssr: false, loading: ChartPlaceholder })
const STATUS: Record<string, string> = { OPEN: 'posición abierta', CLOSED: 'venta' }
const empty = 'flex h-[300px] items-center text-sm text-ink-3 max-[819px]:h-auto max-[819px]:py-8'
const ASSET_BARS = 15

function Trade({ label, trade, none = 'Sin operaciones' }: { label: string; trade: StatData['biggestWinner']; none?: string }) {
  if (!trade) return <KpiCard label={label} value="—" tone="muted">{none}</KpiCard>
  return (
    <KpiCard label={label} value={signed(trade.pnl)} tone={toneOfResult(trade.pnl)}>
      {trade.ticker} ({formatPct(trade.pnl_pct)}) · {STATUS[trade.status] ?? trade.status}
    </KpiCard>
  )
}

/** The n results of largest size, gains or losses, best first: a top n of the best drops every loss. */
export function largestResults<T extends { pnl: number }>(rows: T[], n: number): T[] {
  return [...rows].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, n).sort((a, b) => b.pnl - a.pnl)
}

const days = (n: number | null) => (n === null ? '—' : `${n} días`)
const average = (n: number | null) => (n === null ? '—' : signed(n))

export default function DetailedStats({ data, assetLabel }: { data: StatData; assetLabel: string }) {
  const chartData = largestResults(data.allPnLs, ASSET_BARS)
  const totalPnl = data.realizedPnl + data.openPnl
  const stocks = data.universe === 'stocks'
  const income = data.incomeReceived ?? 0
  const unpriced = data.unpricedPositions ?? 0
  const unpricedList = data.unpricedTickers?.length ? ` (${data.unpricedTickers.join(', ')})` : ''
  // enrichPositionsForStats: a stock without a quote goes to cost; an ON to its last close first.
  const unpricedBasis = stocks ? 'al costo, sin resultado abierto' : 'a su último cierre o, si no lo hay, al costo'

  // Profit factor: null with winners = no losing trades (∞, perfect record);
  // null without winners = no closed trades at all.
  const profitFactorLabel =
    data.profitFactor !== null
      ? `${formatNumber(data.profitFactor)}x`
      : data.winnersCount > 0 ? '∞' : '—'
  const profitFactorTone =
    data.profitFactor === null ? (data.winnersCount > 0 ? 'ok' : 'muted')
      : data.profitFactor >= 1.5 ? 'ok' : data.profitFactor >= 1 ? 'warn' : 'danger'
  const winRate = data.winRate === null ? '—' : formatPct(data.winRate, { digits: 1, sign: false })
  const byMarket = [
    { name: 'Mercado local (BCBA)', value: data.arsExposure },
    { name: 'Resto de las acciones', value: data.usdExposure },
  ].map(e => ({ ...e, pct: data.totalPortfolioValue > 0 ? e.value / data.totalPortfolioValue : 0 }))

  return (
    <div className="grid gap-10">
      <dl className="grid grid-cols-4 gap-x-6 gap-y-5 border-b border-line pb-5 max-[1080px]:grid-cols-2">
        <KpiCard label="Resultado total" value={signed(totalPnl)} tone={toneOfResult(totalPnl)}>
          Abierto {signed(data.openPnl)} · realizado {signed(data.realizedPnl)}
        </KpiCard>
        <KpiCard label="Tasa de acierto" value={winRate} tone={data.winRate === null ? 'muted' : 'neutral'}>
          {data.winRate === null
            ? 'Sin ventas todavía'
            : `${data.winnersCount} ganadoras y ${data.losersCount} perdedoras de ${data.totalTrades} ventas`}
        </KpiCard>
        <Trade label="Mejor operación (abierta o venta)" trade={data.biggestWinner} />
        <Trade label="Peor operación (abierta o venta)" trade={data.biggestLoser}
          none={data.biggestWinner ? 'Ninguna con pérdida' : undefined} />
        {income > 0 && (
          <KpiCard label={stocks ? 'Dividendos cobrados' : 'Cupones cobrados'} value={signed(income)} tone="ok">
            Total histórico. Incluidos en el resultado realizado.
          </KpiCard>
        )}
      </dl>

      {unpriced > 0 && (
        <p role="status" className="rounded-md bg-warn-soft px-4 py-3 text-sm text-warn">
          {unpriced === 1
            ? `1 posición sin cotización${unpricedList}: valuada ${unpricedBasis}.`
            : `${unpriced} posiciones sin cotización${unpricedList}: valuadas ${unpricedBasis}.`}
        </p>
      )}

      <section aria-labelledby="h-riesgo-detalle">
        <SectionHead id="h-riesgo-detalle" title="Riesgo" />
        <dl className="grid grid-cols-3 gap-x-6 gap-y-5 pt-4 max-[819px]:grid-cols-2">
          <SharpeMetric data={data} />
          <VolatilityMetric data={data} />
          <DrawdownMetric data={data} />
        </dl>
      </section>

      {data.cumulativePnl.length > 0 && (
        <section aria-labelledby="h-acumulado">
          <SectionHead id="h-acumulado" title="Resultado acumulado de las ventas" />
          <p className="pt-3 text-[13px] text-ink-3">Cómo creció el resultado de las ventas, una a una.</p>
          <div className="mt-3 h-[260px] max-[819px]:h-[200px]">
            <CumulativeChart data={data.cumulativePnl} />
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 items-start gap-10 max-[1080px]:grid-cols-1">
        <section aria-labelledby="h-mensual" className="min-w-0">
          <SectionHead id="h-mensual" title="Resultado de las ventas por mes" />
          <p className="pt-3 text-[13px] text-ink-3">Cada mes calendario desde la primera venta; 0 si no hubo ventas.</p>
          {data.monthlyReturns.length > 0 ? (
            <div className="mt-3 h-[280px] max-[819px]:h-[200px]">
              <MonthlyChart data={data.monthlyReturns} />
            </div>
          ) : (
            <p className={empty}>Sin ventas todavía.</p>
          )}
        </section>

        <section aria-labelledby="h-distribucion-activo" className="min-w-0">
          <SectionHead id="h-distribucion-activo" title={`Distribución de ${assetLabel}`} />
          <p className="pt-3 text-[13px] text-ink-3">Peso de cada posición abierta. Total {formatUSD(data.totalPortfolioValue)}.</p>
          {data.allocation.length > 0
            ? <div className="pt-2"><ShareList items={data.allocation} /></div>
            : <p className={empty}>Sin datos suficientes.</p>}
        </section>
      </div>

      <div className="grid grid-cols-2 items-start gap-10 max-[1080px]:grid-cols-1">
        <section aria-labelledby="h-por-activo" className="min-w-0">
          <SectionHead id="h-por-activo" title="Resultado por activo" />
          <p className="pt-3 text-[13px] text-ink-3">
            Una barra por activo: resultado abierto, ventas y {stocks ? 'dividendos' : 'cupones'}. Los {ASSET_BARS} de mayor tamaño, sean ganancias o pérdidas.
          </p>
          {chartData.length > 0 ? (
            <div className="mt-3" style={{ height: Math.max(160, chartData.length * 28) }}>
              <AssetChart data={chartData} />
            </div>
          ) : (
            <p className={empty}>Todavía no hay operaciones.</p>
          )}
        </section>

        <div className="grid min-w-0 gap-10">
          {stocks && (
            <section aria-labelledby="h-mercado">
              <SectionHead id="h-mercado" title="Por mercado" />
              <p className="pt-3 text-[13px] text-ink-3">Acciones con ticker local (BCBA) frente al resto, por valor.</p>
              <div className="pt-2"><ShareList items={byMarket} /></div>
            </section>
          )}

          <section aria-labelledby="h-ventas">
            <SectionHead id="h-ventas" title="Ventas" />
            <dl className="grid grid-cols-3 gap-x-6 gap-y-5 pt-4 max-[819px]:grid-cols-2">
              <KpiCard label="Cantidad de ventas" value={String(data.totalTrades)} />
              <KpiCard label="Ganancia promedio" value={average(data.avgWin)}
                tone={data.avgWin === null ? 'muted' : toneOfResult(data.avgWin)}>Por venta con ganancia</KpiCard>
              <KpiCard label="Pérdida promedio" value={average(data.avgLoss)}
                tone={data.avgLoss === null ? 'muted' : toneOfResult(data.avgLoss)}>Por venta con pérdida</KpiCard>
              <KpiCard label="Factor de beneficio" value={profitFactorLabel} tone={profitFactorTone}>
                Ganancias brutas sobre pérdidas brutas
              </KpiCard>
              <KpiCard label="Tenencia promedio" value={days(data.avgHoldingDays)} tone={data.avgHoldingDays === null ? 'muted' : 'neutral'}>
                Desde la primera compra de la posición hasta la venta · mínima {days(data.minHoldingDays)} · máxima {days(data.maxHoldingDays)}
              </KpiCard>
            </dl>
          </section>
        </div>
      </div>
    </div>
  )
}
