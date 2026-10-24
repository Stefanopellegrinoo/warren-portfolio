'use client'

import { useState, useEffect, useCallback } from 'react'
import AddTransactionModal from '@/components/ui/AddTransactionModal'
import ImportModal from '@/components/ui/ImportModal'
import UnpricedNotice from '@/components/ui/UnpricedNotice'
import SummaryHeader from '@/components/resumen/SummaryHeader'
import ValueSection from '@/components/resumen/ValueSection'
import HoldingsList from '@/components/resumen/HoldingsList'
import HoldingsTable from '@/components/resumen/HoldingsTable'
import DistributionList from '@/components/resumen/DistributionList'
import MovementsList from '@/components/resumen/MovementsList'
import AdjustCashDialog from '@/components/resumen/AdjustCashDialog'
import ValueChart from '@/components/resumen/ValueChart'
import { SectionHead } from '@/components/resumen/ui'
import { buildHoldings, distribution, DEFAULT_SORT, type Sort } from '@/lib/resumen/holdings'
import { DEFAULT_CURRENCY, headline, readCurrency, saveCurrency, viewsOf } from '@/lib/resumen/currency'
import type { Currency, CurrencyViews } from '@/lib/multicurrency'
import type { Position, ONPosition, PortfolioSummary } from '@/types'
import { isMarketOpen } from '@/lib/utils'
import { cachedValue, load } from '@/lib/client-cache'
import { getCedearRatios, getPortfolio, POSITIONS_KEY } from '@/lib/warren/positions'

type AssetClass = 'ACCION' | 'CEDEAR' | 'ON'
interface QuickSell { assetClass: AssetClass; ticker: string; quantity: number; price: number }
interface PositionsPayload {
  positions?: Position[]
  onPositions?: ONPosition[]
  summary?: PortfolioSummary
  unpricedCount?: number
  unpricedTickers?: string[]
  lastRefresh?: string | null
  /** Pesos / MEP / Cable views; absent in a summary cached before they existed. */
  currencies?: CurrencyViews
}

// Catalogs that never change during a visit: asked once per tab and at hand on the next visit.
interface Cedears { tickers: string[]; ratios: Record<string, number> }
const CEDEARS_KEY = 'resumen:cedears'
const NAMES_KEY = 'resumen:names'
const NO_CEDEARS: Cedears = { tickers: [], ratios: {} }

const loadCedears = async () => cachedValue<Cedears>(CEDEARS_KEY) ?? load(CEDEARS_KEY, async () => {
  const ratios = await getCedearRatios()
  return { tickers: [...ratios.keys()], ratios: Object.fromEntries([...ratios].map(([t, r]) => [t, Number(r)])) }
})
const loadNames = async () => cachedValue<Record<string, string>>(NAMES_KEY) ?? load(NAMES_KEY, async () => {
  const res = await fetch('/api/activos')
  if (!res.ok) throw new Error(String(res.status))
  const list: { ticker: string; nombre: string }[] = await res.json()
  return Object.fromEntries(list.filter(a => a.nombre && a.nombre.trim().toUpperCase() !== a.ticker.toUpperCase()).map(a => [a.ticker, a.nombre]))
})

function Skeleton() {
  return (
    <div role="status" aria-label="Cargando tu cartera" className="grid gap-3">
      {[0, 1, 2, 3, 4].map(i => <span key={i} className="block h-14 animate-pulse rounded bg-surface-2" />)}
    </div>
  )
}

export default function DashboardPage() {
  // A portfolio this tab already has shows at once; the visit's own request refreshes it behind.
  const [data, setData] = useState<PositionsPayload | null>(() => cachedValue<PositionsPayload>(POSITIONS_KEY) ?? null)
  const [loadError, setLoadError] = useState(false)
  const [cedears, setCedears] = useState<Cedears>(() => cachedValue<Cedears>(CEDEARS_KEY) ?? NO_CEDEARS)
  const [names, setNames] = useState<Record<string, string>>(() => cachedValue<Record<string, string>>(NAMES_KEY) ?? {})
  const [showAddTx, setShowAddTx] = useState(false)
  const [quickSell, setQuickSell] = useState<QuickSell | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [showAdjust, setShowAdjust] = useState(false)
  const [asTable, setAsTable] = useState(false)
  // One order for both views, so switching to all columns keeps it.
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT)
  const [currency, setCurrency] = useState<Currency>(DEFAULT_CURRENCY)
  const [movementsKey, setMovementsKey] = useState(0)
  const [marketOpen, setMarketOpen] = useState(isMarketOpen())
  const [autoRefresh, setAutoRefresh] = useState(isMarketOpen())

  // Shared with every other part of the tab asking for the portfolio at the same time.
  const fetchPositions = useCallback(() => {
    return getPortfolio()
      .then(payload => {
        setData(payload as PositionsPayload)
        setLoadError(false)
      })
      .catch(() => setLoadError(true))
  }, [])

  const refreshAll = useCallback(() => {
    fetchPositions()
    setMovementsKey(k => k + 1)
  }, [fetchPositions])

  useEffect(() => { fetchPositions() }, [fetchPositions])
  // Read after mount: the server render has no storage.
  useEffect(() => { setCurrency(readCurrency()) }, [])

  function chooseCurrency(c: Currency) {
    setCurrency(c)
    saveCurrency(c)
  }

  // CEDEAR list (sale asset class) and company names.
  useEffect(() => {
    loadCedears().then(setCedears).catch(() => {})
    loadNames().then(setNames).catch(() => {})
  }, [])

  useEffect(() => {
    const check = () => {
      const open = isMarketOpen()
      setMarketOpen(open)
      if (!open) setAutoRefresh(false)
    }
    const timer = setInterval(check, 60_000)
    return () => clearInterval(timer)
  }, [])

  function sell(ticker: string) {
    const on = data?.onPositions?.find(p => p.ticker === ticker)
    const pos = on ?? data?.positions?.find(p => p.ticker === ticker)
    if (!pos) return
    const isCedear = !on && cedears.tickers.some(c => c === ticker || ticker.includes(c))
    setQuickSell({ assetClass: on ? 'ON' : isCedear ? 'CEDEAR' : 'ACCION', ticker, quantity: pos.quantity, price: pos.current_price ?? 0 })
    setShowAddTx(true)
  }

  const summary = data?.summary
  const views = data ? viewsOf(data) : null
  const rows = summary
    ? buildHoldings({
        positions: data?.positions ?? [], onPositions: data?.onPositions ?? [], cedearTickers: cedears.tickers, cedearRatios: cedears.ratios, names,
        total: views ? views.totals.value[currency] : summary.total_market_value, views, currency,
      })
    : []
  const total = summary ? (views ? views.totals.value[currency] : summary.total_market_value) : 0
  const cash = summary ? (views ? views.totals.cash[currency] : summary.cash.balance) : 0
  const isEmpty = !!summary && rows.length === 0 && summary.cash.balance === 0
  const figures = summary ? headline(summary, views, currency) : null
  const quotedAt = data?.lastRefresh ? new Date(data.lastRefresh) : null

  return (
    <div className="mx-auto w-full max-w-[1680px] px-4 pb-24 pt-5 sm:px-6 min-[820px]:px-8 min-[820px]:pb-16 min-[820px]:pt-8 xl:px-10">
      <SummaryHeader
        marketOpen={marketOpen}
        autoRefresh={autoRefresh}
        lastRefresh={data?.lastRefresh}
        onRefreshDue={fetchPositions}
        onToggleRefresh={() => setAutoRefresh(a => !a)}
        onImport={() => setShowImport(true)}
        onNew={() => { setQuickSell(null); setShowAddTx(true) }}
        {...(views && { currency, onCurrency: chooseCurrency, fx: { mep: views.fx.mep, ccl: views.fx.ccl } })}
      />

      <UnpricedNotice count={data?.unpricedCount} tickers={data?.unpricedTickers} />

      {/* With numbers already on screen a failed refresh only warns: they may be outdated. */}
      {loadError && (
        <div role="alert" className={`mb-8 flex flex-wrap items-center justify-between gap-3 rounded-md px-4 py-3 text-sm ${summary ? 'bg-warn-soft text-warn' : 'bg-danger-soft text-danger'}`}>
          {summary ? 'No se pudieron actualizar los precios. Lo que ves puede estar desactualizado.' : 'No se pudo cargar tu cartera.'}
          <button type="button" onClick={() => fetchPositions()} className="font-medium underline underline-offset-2 max-[819px]:min-h-11">Reintentar</button>
        </div>
      )}

      {isEmpty && (
        <div className="grid justify-items-start gap-3 py-12">
          <p className="text-ink-2">Todavía no cargaste operaciones.</p>
          <button type="button" onClick={() => setShowAddTx(true)} className="min-h-11 rounded-md bg-primary px-4 font-medium text-primary-on hover:bg-primary-hover">
            Nueva operación
          </button>
        </div>
      )}

      {/* The chart and the movements ask with the page: while the summary loads, the holdings show a skeleton beside them. */}
      {(summary ? !isEmpty : !loadError) && (
        <div className="grid gap-8">
          {figures && <ValueSection figures={figures} />}

          {/* Phone: every holding, then the rest.
              Wide screens: holdings take the main column and the rest sits beside them. */}
          <div className={`resumen-grid grid items-start gap-x-10 gap-y-10 ${asTable ? 'is-table' : ''}`}>
            <section aria-labelledby="h-tenencias" id="tenencias" className="min-w-0 scroll-mt-20 [grid-area:holdings]">
              <SectionHead
                id="h-tenencias"
                title="Tenencias"
                count={summary ? rows.length + 1 : undefined}
                action={
                  <button type="button" onClick={() => setAsTable(t => !t)} className="inline-flex min-h-6 items-center text-[13px] font-medium text-accent-ink hover:underline hover:underline-offset-2 max-[819px]:min-h-11">
                    {asTable ? 'Ver como lista' : 'Ver todas las columnas'}
                  </button>
                }
              />
              {!summary
                ? <div className="pt-3"><Skeleton /></div>
                : asTable
                ? <div className="pt-3"><HoldingsTable rows={rows} sort={sort} onSort={setSort} onSell={sell} /></div>
                : <HoldingsList
                    rows={rows}
                    cash={cash}
                    cashWeightPct={total > 0 ? (cash / total) * 100 : 0}
                    cashNote={views && currency !== 'MEP' ? 'Se registra en dólar MEP' : undefined}
                    onAdjustCash={() => setShowAdjust(true)}
                    sort={sort}
                    onSort={setSort}
                  />}
            </section>

            <section aria-labelledby="h-evolucion" className="min-w-0 [grid-area:chart]">
              <SectionHead id="h-evolucion" title="Evolución" action={{ href: '/statistics', label: 'Rendimiento' }} />
              <ValueChart />
            </section>

            {summary && figures && <div className="min-w-0 [grid-area:dist]"><DistributionList items={distribution(summary, views, currency, rows)} prefix={figures.prefix} /></div>}
            <div className="min-w-0 [grid-area:moves]"><MovementsList refreshKey={movementsKey} onChanged={fetchPositions} /></div>
          </div>
        </div>
      )}

      {quotedAt && (
        <p className="mt-10 text-[13px] text-ink-3">
          Cotizaciones de BYMA y Yahoo Finance, actualizadas el{' '}
          {quotedAt.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })} a las{' '}
          {quotedAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}.
        </p>
      )}

      {showAddTx && (
        <AddTransactionModal
          onClose={() => { setShowAddTx(false); setQuickSell(null) }}
          onSuccess={refreshAll}
          initialData={quickSell ?? undefined}
        />
      )}
      {showImport && <ImportModal onClose={() => setShowImport(false)} onSuccess={refreshAll} />}
      <AdjustCashDialog
        open={showAdjust}
        onClose={() => setShowAdjust(false)}
        onDone={refreshAll}
        currentBalance={summary?.cash.balance ?? 0}
      />
    </div>
  )
}
