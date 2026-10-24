'use client'

import { useState, useEffect, useCallback } from 'react'
import KpiCard, { toneOfResult } from '@/components/ui/KpiCard'
import RiskMetricsRow from '@/components/ui/RiskMetricsRow'
import BenchmarkComparison from '@/components/charts/BenchmarkComparison'
import PortfolioChart from '@/components/charts/PortfolioChart'
import type { PortfolioChartPoint } from '@/components/charts/PortfolioChart'
import ShareList from '@/components/charts/ShareList'
import { signed } from '@/components/charts/tokens'
import { SectionHead } from '@/components/resumen/ui'
import { ErrorNotice } from '@/components/strategies/ui'
import { formatUSD } from '@/lib/utils'
import { requestErrorMessage } from '@/lib/request-errors'
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

const TAB_LABEL: Record<TabType, string> = { general: 'Toda la cartera', stocks: 'Acciones', ons: 'ONs' }

const LOAD_FAILED = 'No se pudieron cargar las estadísticas.'

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
  // General-tab risk, over the whole portfolio — the same universe as its chart (S9).
  const [generalRisk, setGeneralRisk] = useState<StatData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [historyPeriod, setHistoryPeriod] = useState<'30' | '90' | '180' | '365' | 'all'>('90')
  const [history, setHistory] = useState<PortfolioChartPoint[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)

  const load = useCallback(() =>
    Promise.all([
      fetch('/api/statistics?universe=stocks'),
      fetch('/api/statistics/ons'),
      fetch('/api/statistics/combined'),
      fetch('/api/statistics?universe=total')
    ])
      // An error body is an OBJECT, so it is truthy, and every `&& data`
      // gate downstream waves it through — DetailedStats then throws on
      // data.allPnLs.slice and takes the whole page down. A failed fetch
      // must yield null, and its tab says it failed. Likewise a failed
      // metrics fetch must not fill the risk row with "Sin datos suficientes":
      // an error is not a measurement.
      .then(responses => Promise.all(responses.map(r => (r.ok ? r.json() : null))))
      .then(([stocks, ons, combined, general]) => {
        setStocksData(stocks)
        setOnsData(ons)
        setCombinedData(combined)
        setGeneralRisk(general)
        setLoadError(null)
      })
      .catch(err => {
        setStocksData(null)
        setOnsData(null)
        setCombinedData(null)
        setGeneralRisk(null)
        setLoadError(requestErrorMessage(err, LOAD_FAILED))
      })
      .finally(() => setLoading(false)), [])

  useEffect(() => { load() }, [load])

  const retry = () => {
    setLoading(true)
    load()
  }

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

  // The stocks or ONs tab's own data: null when its fetch failed, undefined on the whole-portfolio tab.
  const tabData = activeTab === 'stocks' ? stocksData : activeTab === 'ons' ? onsData : undefined

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
      {!loading && !combinedData && <ErrorNotice onRetry={retry}>{loadError ?? LOAD_FAILED}</ErrorNotice>}

      {!loading && combinedData && (
        // Headline first: total value and results, then how it got there. Each block
        // keeps one slot across tabs, so the chosen benchmark survives a tab switch.
        <div className="grid gap-10">
          {activeTab === 'general' && (
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
          )}

          {/* A tab whose own data failed says so instead of showing only part of itself. */}
          {tabData === null && (
            <ErrorNotice onRetry={retry}>No se pudieron cargar las estadísticas de {activeTab === 'stocks' ? 'acciones' : 'ONs'}.</ErrorNotice>
          )}

          {tabData !== null && evolution}
          {tabData !== null && activeTab !== 'ons' && <BenchmarkComparison universe={UNIVERSE_BY_TAB[activeTab]} />}

          {activeTab === 'general' && (
            <>
              {/* Risk over the whole portfolio — scope stated on screen */}
              {generalRisk
                ? <RiskMetricsRow data={generalRisk} />
                : <ErrorNotice onRetry={retry}>No se pudieron calcular las métricas de riesgo.</ErrorNotice>}

              <section aria-labelledby="h-composicion">
                <SectionHead id="h-composicion" title="Composición" />
                <p className="pt-3 text-[13px] text-ink-3">Por clase de activo.</p>
                {combinedData.composition.length > 0
                  ? <div className="pt-2"><ShareList items={combinedData.composition} /></div>
                  : <p className="py-8 text-sm text-ink-3">Sin datos suficientes.</p>}
              </section>
            </>
          )}

          {tabData && <DetailedStats data={tabData} assetLabel={activeTab === 'stocks' ? 'acciones' : 'ONs'} />}
        </div>
      )}
    </div>
  )
}
