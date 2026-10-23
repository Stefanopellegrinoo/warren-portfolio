'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import AddTransactionModal from '@/components/ui/AddTransactionModal'
import ImportModal from '@/components/ui/ImportModal'
import UnpricedNotice from '@/components/ui/UnpricedNotice'
import ReconciliationBanner, { type ReconciliationResult } from '@/components/ui/ReconciliationBanner'
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

// The worker refreshes prices every minute; polling every 30 s shows them
// at most a minute and a half old.
const REFRESH_INTERVAL_SEC = 30

type AssetClass = 'ACCION' | 'CEDEAR' | 'ON'
interface QuickSell { assetClass: AssetClass; ticker: string; quantity: number; price: number }
interface PositionsPayload {
  positions?: Position[]
  onPositions?: ONPosition[]
  summary?: PortfolioSummary
  unpricedCount?: number
  unpricedTickers?: string[]
  lastRefresh?: string
  /** Pesos / MEP / Cable views; absent in a summary cached before they existed. */
  currencies?: CurrencyViews
}

function Skeleton() {
  return (
    <div role="status" aria-label="Cargando tu cartera" className="grid gap-3">
      {[0, 1, 2, 3, 4].map(i => <span key={i} className="block h-14 animate-pulse rounded bg-surface-2" />)}
    </div>
  )
}

export default function DashboardPage() {
  const [data, setData] = useState<PositionsPayload | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [cedears, setCedears] = useState<string[]>([])
  const [cedearRatios, setCedearRatios] = useState<Record<string, number>>({})
  const [names, setNames] = useState<Record<string, string>>({})
  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(null)
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
  const countdownRef = useRef(REFRESH_INTERVAL_SEC)
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_SEC)

  const fetchPositions = useCallback(() => {
    return fetch('/api/positions')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((payload: PositionsPayload) => {
        setData(payload)
        setLoadError(false)
        if (payload.lastRefresh) {
          const elapsed = Math.floor((Date.now() - new Date(payload.lastRefresh).getTime()) / 1000)
          countdownRef.current = Math.max(1, REFRESH_INTERVAL_SEC - (elapsed % REFRESH_INTERVAL_SEC))
          setCountdown(countdownRef.current)
        }
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

  // Lookups that never change during a visit: CEDEAR list (sale asset class) and company names.
  useEffect(() => {
    fetch('/api/cedears').then(r => (r.ok ? r.json() : [])).then((list: { ticker: string; ratio: number | string }[]) => {
      setCedears(list.map(c => c.ticker))
      setCedearRatios(Object.fromEntries(list.map(c => [c.ticker, Number(c.ratio)])))
    }).catch(() => {})
    fetch('/api/activos').then(r => (r.ok ? r.json() : [])).then((list: { ticker: string; nombre: string }[]) => {
      setNames(Object.fromEntries(list.filter(a => a.nombre && a.nombre.trim().toUpperCase() !== a.ticker.toUpperCase()).map(a => [a.ticker, a.nombre])))
    }).catch(() => {})
    // A failed reconciliation check shows nothing: a broken checker must not alarm the user.
    fetch('/api/reconciliation').then(r => (r.ok ? r.json() : null)).then(setReconciliation).catch(() => {})
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

  useEffect(() => {
    if (!autoRefresh || !marketOpen) return
    const timer = setInterval(() => {
      countdownRef.current -= 1
      if (countdownRef.current <= 0) {
        countdownRef.current = REFRESH_INTERVAL_SEC
        fetchPositions()
      }
      setCountdown(countdownRef.current)
    }, 1000)
    return () => clearInterval(timer)
  }, [autoRefresh, marketOpen, fetchPositions])

  function sell(ticker: string) {
    const on = data?.onPositions?.find(p => p.ticker === ticker)
    const pos = on ?? data?.positions?.find(p => p.ticker === ticker)
    if (!pos) return
    const isCedear = !on && cedears.some(c => c === ticker || ticker.includes(c))
    setQuickSell({ assetClass: on ? 'ON' : isCedear ? 'CEDEAR' : 'ACCION', ticker, quantity: pos.quantity, price: pos.current_price ?? 0 })
    setShowAddTx(true)
  }

  const summary = data?.summary
  const views = data ? viewsOf(data) : null
  const rows = summary
    ? buildHoldings({
        positions: data?.positions ?? [], onPositions: data?.onPositions ?? [], cedearTickers: cedears, cedearRatios, names,
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
        countdown={countdown}
        onToggleRefresh={() => setAutoRefresh(a => !a)}
        onImport={() => setShowImport(true)}
        onNew={() => { setQuickSell(null); setShowAddTx(true) }}
        {...(views && { currency, onCurrency: chooseCurrency, fx: { mep: views.fx.mep, ccl: views.fx.ccl } })}
      />

      <ReconciliationBanner result={reconciliation} />
      <UnpricedNotice count={data?.unpricedCount} tickers={data?.unpricedTickers} />

      {loadError && !summary && (
        <div role="alert" className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          No se pudo cargar tu cartera.
          <button type="button" onClick={() => fetchPositions()} className="font-medium underline underline-offset-2">Reintentar</button>
        </div>
      )}

      {!summary && !loadError && <Skeleton />}

      {isEmpty && (
        <div className="grid justify-items-start gap-3 py-12">
          <p className="text-ink-2">Todavía no cargaste operaciones.</p>
          <button type="button" onClick={() => setShowAddTx(true)} className="min-h-11 rounded-md bg-primary px-4 font-medium text-primary-on hover:bg-primary-hover">
            Nueva operación
          </button>
        </div>
      )}

      {summary && !isEmpty && (
        <div className="grid gap-8">
          <ValueSection figures={figures!} />

          {/* Phone: every holding, then the rest.
              Wide screens: holdings take the main column and the rest sits beside them. */}
          <div className={`resumen-grid grid items-start gap-x-10 gap-y-10 ${asTable ? 'is-table' : ''}`}>
            <section aria-labelledby="h-tenencias" id="tenencias" className="min-w-0 scroll-mt-20 [grid-area:holdings]">
              <SectionHead
                id="h-tenencias"
                title="Tenencias"
                count={rows.length + 1}
                action={
                  <button type="button" onClick={() => setAsTable(t => !t)} className="inline-flex min-h-6 items-center text-[13px] font-medium text-accent-ink hover:underline hover:underline-offset-2 max-[819px]:min-h-11">
                    {asTable ? 'Ver como lista' : 'Ver todas las columnas'}
                  </button>
                }
              />
              {asTable
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

            <div className="min-w-0 [grid-area:dist]"><DistributionList items={distribution(summary, views, currency, rows)} prefix={figures!.prefix} /></div>
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
