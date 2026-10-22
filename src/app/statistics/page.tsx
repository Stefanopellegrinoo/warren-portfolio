'use client'

import { useState, useEffect } from 'react'
import KpiCard, { toneOfResult } from '@/components/ui/KpiCard'
import RiskMetricsRow from '@/components/ui/RiskMetricsRow'
import BenchmarkComparison from '@/components/charts/BenchmarkComparison'
import PortfolioChart from '@/components/charts/PortfolioChart'
import type { PortfolioChartPoint } from '@/components/charts/PortfolioChart'
import ShareList from '@/components/charts/ShareList'
import { signed } from '@/components/charts/tokens'
import { SectionHead } from '@/components/resumen/ui'
import { formatUSD } from '@/lib/utils'
import type { Universe } from '@/lib/asset-universe'
import DetailedStats, { type StatData } from './DetailedStats'

interface CombinedData {
  totalValue: number
  composition: { name: string; value: number; pct: number }[]
  stocks: {
    value: number
    openPnl: number
    realizedPnl: number
    totalPnl: number
    positionCount: number
    closedTradesCount: number
  }
  ons: {
    value: number
    openPnl: number
    realizedPnl: number
    totalPnl: number
    positionCount: number
    closedTradesCount: number
  }
}

type TabType = 'general' | 'stocks' | 'ons'

const UNIVERSE_BY_TAB: Record<TabType, Universe> = {
  general: 'total',
  stocks: 'stocks',
  ons: 'ons',
}

const TAB_LABEL: Record<TabType, string> = { general: 'General', stocks: 'Acciones', ons: 'ONs' }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function Skeleton() {
  return (
    <div role="status" aria-label="Cargando el rendimiento" className="grid gap-3">
      {[0, 1, 2, 3, 4].map(i => <span key={i} className="block h-14 animate-pulse rounded bg-surface-2" />)}
    </div>
  )
}

export default function StatisticsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('general')
  const [stocksData, setStocksData] = useState<StatData | null>(null)
  const [onsData, setOnsData] = useState<StatData | null>(null)
  const [combinedData, setCombinedData] = useState<CombinedData | null>(null)
  // General-tab risk, over the MEASURABLE base (stocks + cash) — a different
  // universe from the full-portfolio chart above it. Design A2.
  const [generalRisk, setGeneralRisk] = useState<StatData | null>(null)
  const [loading, setLoading] = useState(true)
  const [historyPeriod, setHistoryPeriod] = useState<'30' | '90' | '180' | '365' | 'all'>('90')
  const [history, setHistory] = useState<PortfolioChartPoint[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)

  useEffect(() => {
    async function fetchAllStats() {
      try {
        const [stocksRes, onsRes, combinedRes, generalRes] = await Promise.all([
          fetch('/api/statistics?universe=stocks'),
          fetch('/api/statistics/ons'),
          fetch('/api/statistics/combined'),
          fetch('/api/statistics?universe=measurable')
        ])

        const [stocks, ons, combined, general] = await Promise.all([
          stocksRes.json(),
          onsRes.json(),
          combinedRes.json(),
          generalRes.json()
        ])

        // An error body is an OBJECT, so it is truthy, and every `&& data`
        // gate downstream waves it through — DetailedStats then throws on
        // data.allPnLs.slice and takes the whole page down. A failed fetch
        // must yield null so the tab simply does not render. This route
        // gained two new non-200 paths (400 on an unknown universe, 500 on a
        // transactions-fetch failure), so it is no longer a remote case.
        setStocksData(stocksRes.ok ? stocks : null)
        setOnsData(onsRes.ok ? ons : null)
        setCombinedData(combinedRes.ok ? combined : null)
        // A failed metrics fetch must lose the ROW, not fill it with cards
        // reading "Sin datos suficientes" — an error is not a measurement.
        setGeneralRisk(generalRes.ok ? general : null)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchAllStats()
  }, [])

  useEffect(() => {
    let cancelled = false
    async function fetchHistory() {
      // Tolerant by design: losing the chart must not blank the page the way
      // the other fetches would. Same posture the route itself takes with its
      // live point. But "tolerant" must not mean "silently show the PREVIOUS
      // period's (or tab's) data under the NEW selection's highlighted button"
      // — on any failure we clear the series so the chart falls back to its
      // own honest empty state instead of asserting stale data.
      setHistoryLoading(true)
      try {
        const universe = UNIVERSE_BY_TAB[activeTab]
        const res = await fetch(`/api/portfolio-history?days=${historyPeriod}&universe=${universe}`)
        if (!res.ok) {
          console.error(`[Statistics] Evolution chart fetch failed: ${res.status}`)
          if (!cancelled) {
            setHistory([])
            setHistoryLoading(false)
          }
          return
        }
        const body = await res.json()
        if (cancelled) return
        setHistory(Array.isArray(body.data) ? body.data : [])
        setHistoryLoading(false)
      } catch (err) {
        console.error('[Statistics] Evolution chart unavailable:', err)
        if (!cancelled) {
          setHistory([])
          setHistoryLoading(false)
        }
      }
    }
    fetchHistory()
    return () => { cancelled = true }
  }, [historyPeriod, activeTab])

  const tabs: TabType[] = combinedData
    ? (['general', 'stocks', 'ons'] as TabType[]).filter(t =>
        t === 'general' || (t === 'stocks' ? combinedData.stocks.positionCount > 0 : combinedData.ons.positionCount > 0))
    : ['general']

  const evolution = (
    <section aria-labelledby="h-evolucion">
      <SectionHead id="h-evolucion" title={activeTab === 'general' ? 'Evolución de la cartera' : `Evolución de ${TAB_LABEL[activeTab]}`} />
      <p className="pt-3 text-[13px] text-ink-3">Valor de mercado contra el capital invertido.</p>
      <PortfolioChart data={history} period={historyPeriod} onPeriodChange={setHistoryPeriod} loading={historyLoading} />
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

      {loading && <Skeleton />}

      {/* Loading is DONE and the page still has no composition data. A spinner here
          would assert "still working" forever; say what actually happened instead. */}
      {!loading && !combinedData && (
        <div role="alert" className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          No se pudieron cargar las estadísticas. Reintentá en unos segundos; si sigue igual, revisá que el servicio esté disponible.
        </div>
      )}

      {!loading && combinedData && (
        <div className="grid gap-10">
          {/* ON history mixes cost (≤07-22) and market (≥07-23) valuations, a fake +2.7pp jump.
              Only stocks + cash replay to the dollar, so General compares `measurable`, ONs not at all. */}
          {activeTab !== 'ons' && (
            <BenchmarkComparison universe={activeTab === 'general' ? 'measurable' : UNIVERSE_BY_TAB[activeTab]} />
          )}

          {activeTab === 'general' && (
            <>
              {/* Evolution chart, projected onto the full portfolio. */}
              {evolution}

              <dl className="grid grid-cols-3 gap-x-6 gap-y-5 border-b border-line pb-5 max-[819px]:grid-cols-2">
                <div className="min-w-0 max-[819px]:col-span-2">
                  <dt className="text-[13px] text-ink-3">Valor total de la cartera</dt>
                  <dd className="font-serif text-2xl font-normal tabular-nums">{formatUSD(combinedData.totalValue)}</dd>
                </div>
                <KpiCard label="Resultado de acciones" value={signed(combinedData.stocks.totalPnl)} tone={toneOfResult(combinedData.stocks.totalPnl)}>
                  {plural(combinedData.stocks.positionCount, 'posición', 'posiciones')} · {plural(combinedData.stocks.closedTradesCount, 'operación cerrada', 'operaciones cerradas')}
                </KpiCard>
                <KpiCard label="Resultado de ONs" value={signed(combinedData.ons.totalPnl)} tone={toneOfResult(combinedData.ons.totalPnl)}>
                  {plural(combinedData.ons.positionCount, 'posición', 'posiciones')} · {plural(combinedData.ons.closedTradesCount, 'operación cerrada', 'operaciones cerradas')}
                </KpiCard>
              </dl>

              {/* Risk over the measurable base — scope stated on screen (A2) */}
              <RiskMetricsRow data={generalRisk} />

              <section aria-labelledby="h-composicion">
                <SectionHead id="h-composicion" title="Composición" />
                <p className="pt-3 text-[13px] text-ink-3">Por clase de activo.</p>
                {combinedData.composition.length > 0
                  ? <div className="pt-2"><ShareList items={combinedData.composition} /></div>
                  : <p className="py-8 text-sm text-ink-3">Sin datos suficientes.</p>}
              </section>
            </>
          )}

          {activeTab === 'stocks' && stocksData && (
            <>
              {evolution}
              <DetailedStats data={stocksData} assetLabel="acciones" />
            </>
          )}

          {activeTab === 'ons' && onsData && (
            <>
              {evolution}
              <DetailedStats data={onsData} assetLabel="ONs" />
            </>
          )}
        </div>
      )}
    </div>
  )
}
