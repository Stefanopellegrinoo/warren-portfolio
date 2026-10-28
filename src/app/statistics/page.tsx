'use client'

import { useEffect, useState } from 'react'
import KpiCard, { toneOfResult } from '@/components/ui/KpiCard'
import RiskMetricsRow, { negativeCashNote } from '@/components/ui/RiskMetricsRow'
import BenchmarkComparison from '@/components/charts/BenchmarkComparison'
import PortfolioChart from '@/components/charts/PortfolioChart'
import type { PortfolioChartPoint } from '@/components/charts/PortfolioChart'
import ShareList from '@/components/charts/ShareList'
import { signed } from '@/components/charts/tokens'
import { SectionHead } from '@/components/resumen/ui'
import { ErrorNotice } from '@/components/strategies/ui'
import { formatNumber } from '@/lib/utils'
import { requestErrorMessage } from '@/lib/request-errors'
import { useCached } from '@/lib/client-cache'
import { useCachedPerVisit } from '@/components/charts/use-cached-per-visit'
import { argentinaDate } from '@/lib/utils'
import type { Universe } from '@/lib/asset-universe'
import type { Currency } from '@/lib/multicurrency'
import { DEFAULT_CURRENCY, headline, readCurrency, viewsOf } from '@/lib/resumen/currency'
import { distribution } from '@/lib/resumen/holdings'
import { getPortfolio } from '@/lib/warren/positions'
import DetailedStats, { type StatData } from './DetailedStats'

interface Counts { positionCount: number; closedTradesCount: number }
interface CombinedData { stocks: Counts; ons: Counts }

type Portfolio = Awaited<ReturnType<typeof getPortfolio>>

/**
 * The dashboard's own figures in the dashboard's currency: the same response and the same rule,
 * so both pages show one total (odd/tasks/statistics-truth.md S1). A summary cached before the
 * per-class results existed has none: no result rather than one in another currency.
 */
function valueOf(payload: Portfolio, currency: Currency) {
  const views = viewsOf(payload)
  const { prefix, total } = headline(payload.summary, views, currency)
  const result = (c: 'stocks' | 'ons') => {
    const b = views?.totals.byClass?.[c]
    return b ? b.openPnl[currency] + b.realized[currency] : null
  }
  return {
    total,
    money: (n: number) => `${prefix}\u00a0${formatNumber(n)}`,
    composition: distribution(payload.summary, views, currency)
      .filter(d => d.value > 0)
      .map(d => ({ name: d.label, value: d.value, pct: d.pct / 100 })),
    stocks: result('stocks'),
    ons: result('ons'),
  }
}

type TabType = 'general' | 'stocks' | 'ons'

const UNIVERSE_BY_TAB: Record<TabType, Universe> = {
  general: 'total',
  stocks: 'stocks',
  ons: 'ons',
}

const TAB_LABEL: Record<TabType, string> = { general: 'Toda la cartera', stocks: 'Acciones', ons: 'ONs' }

const LOAD_FAILED = 'No se pudieron cargar las estadísticas.'
const VALUE_FAILED = 'No se pudo cargar el valor de la cartera.'
const STATS = {
  stocks: '/api/statistics?universe=stocks',
  ons: '/api/statistics/ons',
  combined: '/api/statistics/combined',
  total: '/api/statistics?universe=total',
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function Skeleton({ label = 'Cargando el rendimiento', rows = 5 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} className="grid gap-3">
      {Array.from({ length: rows }, (_, i) => <span key={i} className="block h-14 animate-pulse rounded bg-surface-2" />)}
    </div>
  )
}

type Period = '30' | '90' | '180' | '365' | 'all'

/** One statistics request: an error body never becomes data (it would crash DetailedStats). */
const statsOf = <T,>(url: string) => async (): Promise<T> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(LOAD_FAILED)
  return res.json()
}

interface History { points: PortfolioChartPoint[]; note: string | null }

/**
 * The full series of a part, asked once; a period is cut here, as the route cuts it (Argentine days back from today).
 * Only its measured part is drawn: the whole portfolio starts the day after its last negative-cash day, and with
 * negative cash today nothing is (odd/tasks/statistics-truth.md S4). The route says where, and the note says why.
 */
async function fullHistory(universe: Universe): Promise<History> {
  const res = await fetch(`/api/portfolio-history?days=all&universe=${universe}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json()
  const data: PortfolioChartPoint[] = Array.isArray(body.data) ? body.data : []
  const from: unknown = body.measuredFrom
  return {
    points: body.unavailableReason ? [] : typeof from === 'string' ? data.filter(p => p.snapshot_date >= from) : data,
    note: negativeCashNote(body),
  }
}
function cut(series: PortfolioChartPoint[], period: Period): PortfolioChartPoint[] {
  if (period === 'all') return series
  const from = new Date(`${argentinaDate()}T00:00:00Z`)
  from.setUTCDate(from.getUTCDate() - parseInt(period))
  const since = from.toISOString().split('T')[0]
  return series.filter(p => p.snapshot_date >= since)
}

export default function StatisticsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('general')
  const [historyPeriod, setHistoryPeriod] = useState<Period>('90')
  // Each block shows when its own request answers (S9); a page seen before shows its last data at once.
  const stocks = useCached('statistics:stocks', statsOf<StatData>(STATS.stocks))
  const ons = useCached('statistics:ons', statsOf<StatData>(STATS.ons))
  const combined = useCached('statistics:combined', statsOf<CombinedData>(STATS.combined))
  // Value, results and composition: the dashboard's answer, in the currency chosen there (S1).
  const portfolio = useCached('statistics:portfolio', () => getPortfolio().catch((err: unknown) => {
    throw err instanceof TypeError ? err : new Error(VALUE_FAILED) // its own message is for developers
  }))
  const [currency, setCurrency] = useState<Currency>(DEFAULT_CURRENCY)
  useEffect(() => { setCurrency(readCurrency()) }, [])
  const value = portfolio.data ? valueOf(portfolio.data, currency) : null
  // General-tab risk, over the whole portfolio — the same universe as its chart (S9).
  const general = useCached('statistics:total', statsOf<StatData>(STATS.total))
  // The full series of each part, asked once per visit: a period or tab change asks nothing (S9). Tolerant by
  // design: a failed history leaves the chart's own empty state, never another tab's series.
  const universe = UNIVERSE_BY_TAB[activeTab]
  const history = useCachedPerVisit(`statistics:history:${universe}`, () => fullHistory(universe))
  const changePeriod = (p: Period) => {
    setHistoryPeriod(p)
    if (history.error) history.reload()
  }

  const combinedData = combined.data ?? null
  const failed = <T,>(r: { data?: T; error: unknown }) => !r.data && !!r.error
  const retry = () => { stocks.reload(); ons.reload(); combined.reload(); general.reload(); portfolio.reload() }

  const tabs: TabType[] = combinedData
    ? (['general', 'stocks', 'ons'] as TabType[]).filter(t =>
        t === 'general' || (t === 'stocks' ? combinedData.stocks.positionCount > 0 : combinedData.ons.positionCount > 0))
    : ['general']

  // The stocks or ONs tab's own data: null when its fetch failed, undefined while it loads and on the whole-portfolio tab.
  const own = activeTab === 'stocks' ? stocks : activeTab === 'ons' ? ons : null
  const tabData = own && failed(own) ? null : own?.data

  const evolution = (
    <section aria-labelledby="h-evolucion">
      <SectionHead id="h-evolucion" title={activeTab === 'general' ? 'Evolución de la cartera' : `Evolución de ${TAB_LABEL[activeTab]}`} />
      <p className="pt-3 text-[13px] text-ink-3">Valor de mercado contra el capital invertido.</p>
      {history.data?.note && <p className="pt-1 text-[13px] text-warn">{history.data.note}</p>}
      <PortfolioChart data={cut(history.data?.points ?? [], historyPeriod)} period={historyPeriod} onPeriodChange={changePeriod} loading={!history.data && history.loading} />
    </section>
  )

  return (
    <div className="mx-auto w-full max-w-[1240px] px-10 pb-16 pt-8 max-[819px]:px-4 max-[819px]:pb-24 max-[819px]:pt-5">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-[2rem] font-normal leading-tight tracking-[-0.015em] max-[819px]:text-2xl">Rendimiento</h1>
          <p className="mt-1 text-ink-3">Riesgo, resultados y evolución de tu cartera.</p>
        </div>
        {combinedData && tabs.length > 1 && (
          <div role="group" aria-label="Qué parte de la cartera mirar" className="inline-flex gap-0.5 rounded-md border border-line bg-surface-2 p-0.5 max-[819px]:w-full">
            {tabs.map(t => (
              <button
                key={t}
                type="button"
                aria-pressed={activeTab === t}
                onClick={() => setActiveTab(t)}
                className="inline-flex min-h-8 items-center justify-center rounded px-3 text-[13px] text-ink-2 hover:text-ink aria-pressed:bg-surface aria-pressed:font-medium aria-pressed:text-ink aria-pressed:shadow-[0_0_0_1px_var(--line)] max-[819px]:min-h-11 max-[819px]:flex-1"
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Without the portfolio summary there are no tabs, headline or composition: say what happened. */}
      {failed(combined) && <ErrorNotice onRetry={retry}>{requestErrorMessage(combined.error, LOAD_FAILED)}</ErrorNotice>}

      {!failed(combined) && (
        // Headline first: total value and results, then how it got there. Each block
        // keeps one slot across tabs, so the chosen benchmark survives a tab switch.
        <div className="grid gap-10">
          {activeTab === 'general' && (value ? (
            <dl className="grid grid-cols-3 gap-x-6 gap-y-5 border-b border-line pb-5 max-[819px]:grid-cols-2">
              <div className="min-w-0 max-[819px]:col-span-2">
                <dt className="text-[13px] text-ink-3">Valor total de la cartera</dt>
                <dd className="font-serif text-2xl font-normal tabular-nums">{value.money(value.total)}</dd>
              </div>
              <KpiCard label="Resultado de acciones" value={value.stocks === null ? '—' : signed(value.stocks)} tone={toneOfResult(value.stocks ?? 0)}>
                {combinedData && <>{plural(combinedData.stocks.positionCount, 'posición', 'posiciones')} · {plural(combinedData.stocks.closedTradesCount, 'venta', 'ventas')}</>}
              </KpiCard>
              <KpiCard label="Resultado de ONs" value={value.ons === null ? '—' : signed(value.ons)} tone={toneOfResult(value.ons ?? 0)}>
                {combinedData && <>{plural(combinedData.ons.positionCount, 'posición', 'posiciones')} · {plural(combinedData.ons.closedTradesCount, 'venta', 'ventas')}</>}
              </KpiCard>
            </dl>
          ) : failed(portfolio)
            ? <ErrorNotice onRetry={retry}>{requestErrorMessage(portfolio.error, VALUE_FAILED)}</ErrorNotice>
            : <Skeleton label="Cargando el resumen" rows={1} />)}

          {/* A tab whose own data failed says so instead of showing only part of itself. */}
          {tabData === null && (
            <ErrorNotice onRetry={retry}>No se pudieron cargar las estadísticas de {activeTab === 'stocks' ? 'acciones' : 'ONs'}.</ErrorNotice>
          )}

          {tabData !== null && evolution}
          {tabData !== null && activeTab !== 'ons' && <BenchmarkComparison universe={UNIVERSE_BY_TAB[activeTab]} />}

          {activeTab === 'general' && (
            <>
              {/* Risk over the whole portfolio — scope stated on screen */}
              {general.data
                ? <RiskMetricsRow data={general.data} />
                : failed(general)
                  ? <ErrorNotice onRetry={retry}>No se pudieron calcular las métricas de riesgo.</ErrorNotice>
                  : <Skeleton label="Cargando las métricas de riesgo" rows={1} />}

              <section aria-labelledby="h-composicion">
                <SectionHead id="h-composicion" title="Composición" />
                <p className="pt-3 text-[13px] text-ink-3">Por clase de activo.</p>
                {!value
                  ? !failed(portfolio) && <div className="pt-2"><Skeleton label="Cargando la composición" rows={2} /></div>
                  : value.composition.length > 0
                    ? <div className="pt-2"><ShareList items={value.composition} format={value.money} /></div>
                    : <p className="py-8 text-sm text-ink-3">Sin datos suficientes.</p>}
              </section>
            </>
          )}

          {tabData && <DetailedStats data={tabData} assetLabel={activeTab === 'stocks' ? 'acciones' : 'ONs'} />}
          {own && tabData === undefined && <Skeleton label="Cargando las estadísticas" />}
        </div>
      )}
    </div>
  )
}
