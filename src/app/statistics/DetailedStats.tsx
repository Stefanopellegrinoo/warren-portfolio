'use client'

import { ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, LineChart, Line } from 'recharts'
import KpiCard, { toneOfResult } from '@/components/ui/KpiCard'
import { SharpeMetric, VolatilityMetric, DrawdownMetric } from '@/components/ui/RiskMetricsRow'
import ShareList from '@/components/charts/ShareList'
import { AXIS, GRID, TOOLTIP, GAIN, LOSS, signed, axisSigned } from '@/components/charts/tokens'
import { SectionHead } from '@/components/resumen/ui'
import { formatUSD, formatPct, formatNumber } from '@/lib/utils'
import type { SeriesProvenance } from '@/lib/series-provenance'

export interface StatData {
  /** Null below MIN_INTERVALS_DRAWDOWN — "Sin datos suficientes", never 0. */
  maxDrawdown: number | null
  winRate: number | null
  totalPortfolioValue: number
  unpricedPositions?: number
  allocation: { name: string; value: number; pct: number }[]
  realizedPnl: number
  openPnl: number
  biggestWinner: { ticker: string; pnl: number; pnl_pct: number; status: string } | null
  biggestLoser: { ticker: string; pnl: number; pnl_pct: number; status: string } | null
  allPnLs: { ticker: string; pnl: number }[]
  monthlyReturns: { month: string; pnl: number; trades: number }[]
  cumulativePnl: { date: string; ticker: string; pnl: number; cumulative: number }[]
  avgHoldingDays: number
  maxHoldingDays: number
  minHoldingDays: number
  avgWin: number
  avgLoss: number
  profitFactor: number | null
  sharpeRatio: number | null
  annualizedVol: number | null
  returnIntervals?: number
  drawdownIntervals?: number
  /** Which asset universe these metrics were computed over. */
  universe?: string
  provenance?: SeriesProvenance
  drawdownIntervalsSkipped?: number
  monthlyStdDev: number | null
  winnersCount: number
  losersCount: number
  totalTrades: number
  arsExposure: number
  usdExposure: number
  /** Lifetime coupon income (ONs universe only). Not part of the chart series. */
  couponsReceived?: number
}

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const STATUS: Record<string, string> = { OPEN: 'abierta', CLOSED: 'cerrada' }
const empty = 'flex h-[300px] items-center text-sm text-ink-3 max-[819px]:h-auto max-[819px]:py-8'

function Trade({ label, trade }: { label: string; trade: StatData['biggestWinner'] }) {
  if (!trade) return <KpiCard label={label} value="—" tone="muted">Sin operaciones</KpiCard>
  return (
    <KpiCard label={label} value={signed(trade.pnl)} tone={toneOfResult(trade.pnl)}>
      {trade.ticker} ({formatPct(trade.pnl_pct)}) · {STATUS[trade.status] ?? trade.status}
    </KpiCard>
  )
}

export default function DetailedStats({ data, assetLabel }: { data: StatData; assetLabel: string }) {
  const chartData = data.allPnLs.slice(0, 15)
  const totalPnl = data.realizedPnl + data.openPnl

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
  const exposure = [
    { name: 'USD, mercados internacionales', value: data.usdExposure },
    { name: 'ARS, mercado local vía CCL', value: data.arsExposure },
  ].map(e => ({ ...e, pct: data.totalPortfolioValue > 0 ? e.value / data.totalPortfolioValue : 0 }))

  return (
    <div className="grid gap-10">
      <dl className="grid grid-cols-4 gap-x-6 gap-y-5 border-b border-line pb-5 max-[1080px]:grid-cols-2">
        <KpiCard label="Resultado total" value={signed(totalPnl)} tone={toneOfResult(totalPnl)}>
          Abierto {signed(data.openPnl)} · realizado {signed(data.realizedPnl)}
        </KpiCard>
        <KpiCard label="Tasa de acierto" value={winRate} tone={data.winRate === null ? 'muted' : 'neutral'}>
          {data.winRate === null
            ? 'Sin operaciones cerradas todavía'
            : `${data.winnersCount} ganadoras y ${data.losersCount} perdedoras de ${data.totalTrades}`}
        </KpiCard>
        <Trade label="Mejor operación" trade={data.biggestWinner} />
        <Trade label="Peor operación" trade={data.biggestLoser} />
        {(data.couponsReceived ?? 0) > 0 && (
          <KpiCard label="Cupones cobrados" value={signed(data.couponsReceived ?? 0)} tone="ok">
            Total histórico. No forma parte de la serie del gráfico.
          </KpiCard>
        )}
      </dl>

      <section aria-labelledby="h-riesgo-detalle">
        <SectionHead id="h-riesgo-detalle" title="Riesgo" />
        <dl className="grid grid-cols-5 gap-x-6 gap-y-5 pt-4 max-[1080px]:grid-cols-3 max-[819px]:grid-cols-2">
          <SharpeMetric data={data} />
          <VolatilityMetric data={data} />
          <KpiCard label="Factor de beneficio" value={profitFactorLabel} tone={profitFactorTone}>
            Ganancias brutas sobre pérdidas brutas
          </KpiCard>
          <DrawdownMetric data={data} />
          <KpiCard label="Tenencia promedio" value={`${data.avgHoldingDays} días`}>
            Mínima {data.minHoldingDays} · máxima {data.maxHoldingDays}
          </KpiCard>
        </dl>
      </section>

      {data.cumulativePnl.length > 0 && (
        <section aria-labelledby="h-acumulado">
          <SectionHead id="h-acumulado" title="Resultado realizado acumulado" />
          <p className="pt-3 text-[13px] text-ink-3">Cómo creció el resultado de las operaciones cerradas.</p>
          <div className="mt-3 h-[260px] max-[819px]:h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.cumulativePnl} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} accessibilityLayer>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="date" {...AXIS} minTickGap={24}
                  tickFormatter={(v: string) => { const d = new Date(v); return `${d.getDate()}/${d.getMonth() + 1}` }} />
                <YAxis {...AXIS} width={52} tickFormatter={axisSigned} />
                <Tooltip {...TOOLTIP}
                  formatter={(value: number) => [signed(value), 'Acumulado']}
                  labelFormatter={(label: string) => new Date(label).toLocaleDateString('es-AR')} />
                <Line type="monotone" dataKey="cumulative" stroke="var(--accent)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 items-start gap-10 max-[1080px]:grid-cols-1">
        <section aria-labelledby="h-mensual" className="min-w-0">
          <SectionHead id="h-mensual" title="Resultado por mes" />
          <p className="pt-3 text-[13px] text-ink-3">Resultado realizado en cada mes calendario.</p>
          {data.monthlyReturns.length > 0 ? (
            <div className="mt-3 h-[280px] max-[819px]:h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthlyReturns} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} accessibilityLayer>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="month" {...AXIS}
                    tickFormatter={(v: string) => { const [y, m] = v.split('-'); return `${m}/${y.slice(2)}` }} />
                  <YAxis {...AXIS} width={52} tickFormatter={axisSigned} />
                  <Tooltip {...TOOLTIP}
                    formatter={(value: number) => [signed(value), 'Resultado']}
                    labelFormatter={(label: string) => { const [y, m] = label.split('-'); return `${MONTHS[parseInt(m) - 1]} ${y}` }} />
                  <Bar dataKey="pnl" radius={[2, 2, 0, 0]} maxBarSize={28} isAnimationActive={false}>
                    {data.monthlyReturns.map((entry, i) => <Cell key={i} fill={entry.pnl >= 0 ? GAIN : LOSS} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className={empty}>Sin operaciones cerradas todavía.</p>
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
          <p className="pt-3 text-[13px] text-ink-3">Posiciones abiertas y cerradas, las 15 de mayor resultado.</p>
          {chartData.length > 0 ? (
            <div className="mt-3" style={{ height: Math.max(160, chartData.length * 28) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
                  <CartesianGrid stroke="var(--line)" horizontal={false} />
                  <XAxis type="number" {...AXIS} tickFormatter={axisSigned} />
                  <YAxis dataKey="ticker" type="category" {...AXIS} tick={{ fill: 'var(--ink-2)', fontSize: 12 }} width={56} />
                  <Tooltip {...TOOLTIP} formatter={(value: number) => [signed(value), 'Resultado']} />
                  <Bar dataKey="pnl" radius={[0, 2, 2, 0]} barSize={14} isAnimationActive={false}>
                    {chartData.map((entry, i) => <Cell key={i} fill={entry.pnl >= 0 ? GAIN : LOSS} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className={empty}>Todavía no hay operaciones.</p>
          )}
        </section>

        <div className="grid min-w-0 gap-10">
          <section aria-labelledby="h-moneda">
            <SectionHead id="h-moneda" title="Exposición por moneda" />
            <div className="pt-2"><ShareList items={exposure} /></div>
          </section>

          <section aria-labelledby="h-operaciones">
            <SectionHead id="h-operaciones" title="Operaciones" />
            <dl className="grid grid-cols-3 gap-x-6 gap-y-5 pt-4 max-[819px]:grid-cols-2">
              <KpiCard label="Cantidad" value={String(data.totalTrades)} />
              <KpiCard label="Ganancia promedio" value={signed(data.avgWin)} tone={toneOfResult(data.avgWin)} />
              <KpiCard label="Pérdida promedio" value={signed(data.avgLoss)} tone={toneOfResult(data.avgLoss)} />
            </dl>
          </section>
        </div>
      </div>
    </div>
  )
}
