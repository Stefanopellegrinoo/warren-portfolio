'use client'

import { useState, useEffect, useCallback } from 'react'
import { formatUSD, formatPct, formatDate, cn } from '@/lib/utils'
import type { ClosedTrade, Transaction } from '@/types'
import { TrendingUp, TrendingDown, ChevronUp, ChevronDown, Trash2 } from 'lucide-react'

type ClosedSortKey = 'ticker' | 'open_date' | 'close_date' | 'days_held' | 'avg_cost' | 'close_price' | 'quantity' | 'invested' | 'proceeds' | 'pnl' | 'pnl_pct'
type AllSortKey = 'date' | 'ticker' | 'operation' | 'quantity' | 'price' | 'commission' | 'total' | 'created_at'
type SortDir = 'asc' | 'desc'

const CLOSED_COLUMNS: { label: string; key: ClosedSortKey }[] = [
  { label: 'TICKER',        key: 'ticker' },
  { label: 'COMPRA',        key: 'open_date' },
  { label: 'VENTA',         key: 'close_date' },
  { label: 'DÍAS',          key: 'days_held' },
  { label: 'COSTO PROM.',   key: 'avg_cost' },
  { label: 'PRECIO CIERRE', key: 'close_price' },
  { label: 'CANTIDAD',      key: 'quantity' },
  { label: 'INVERTIDO',     key: 'invested' },
  { label: 'RETORNO',       key: 'proceeds' },
  { label: 'P&L USD',       key: 'pnl' },
  { label: 'P&L %',         key: 'pnl_pct' },
]

const ALL_COLUMNS: { label: string; key: AllSortKey }[] = [
  { label: 'FECHA',         key: 'date' },
  { label: 'TICKER',        key: 'ticker' },
  { label: 'OPERACIÓN',     key: 'operation' },
  { label: 'CANTIDAD',      key: 'quantity' },
  { label: 'PRECIO',        key: 'price' },
  { label: 'COMISIÓN',      key: 'commission' },
  { label: 'CARGA',         key: 'created_at' },
  { label: '',              key: 'date' }, // For delete button
]

export default function HistoryPage() {
  const [activeTab, setActiveTab] = useState<'closed' | 'all'>('closed')
  
  // Closed Trades State
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([])
  const [closedLoading, setClosedLoading] = useState(true)
  const [closedFilter, setClosedFilter] = useState('')
  const [closedSortKey, setClosedSortKey] = useState<ClosedSortKey>('close_date')
  const [closedSortDir, setClosedSortDir] = useState<SortDir>('desc')

  // All Transactions State
  const [allTx, setAllTx] = useState<Transaction[]>([])
  const [allLoading, setAllLoading] = useState(false)
  const [allFilter, setAllFilter] = useState('')
  const [allSortKey, setAllSortKey] = useState<AllSortKey>('date')
  const [allSortDir, setAllSortDir] = useState<SortDir>('desc')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchClosedTrades = useCallback(async () => {
    setClosedLoading(true)
    try {
      const res = await fetch('/api/transactions/closed')
      const data = await res.json()
      setClosedTrades(data.data ?? [])
    } catch (err) {
      console.error(err)
    } finally {
      setClosedLoading(false)
    }
  }, [])

  const fetchAllTransactions = useCallback(async () => {
    setAllLoading(true)
    try {
      const res = await fetch('/api/transactions?limit=1000') // Adjust limit if needed
      const data = await res.json()
      setAllTx(data.data ?? [])
    } catch (err) {
      console.error(err)
    } finally {
      setAllLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'closed') {
      fetchClosedTrades()
    } else {
      fetchAllTransactions()
    }
  }, [activeTab, fetchClosedTrades, fetchAllTransactions])

  async function handleDelete(id: string) {
    if (!confirm('¿Estás seguro que querés borrar esta operación? Esto recalculará toda la posición desde cero.')) return
    
    setDeletingId(id)
    try {
      const res = await fetch(`/api/transactions/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Error deleting transaction')
      
      // Refresh the data on current tab
      if (activeTab === 'closed') {
        await fetchClosedTrades()
      } else {
        await fetchAllTransactions()
      }
      
      // ALSO refresh the dashboard by navigating to it and back
      // This ensures portfolio positions and cash are updated
      // We use a small delay to allow backend processing
      setTimeout(() => {
        // Force a hard refresh of dashboard by temporarily navigating away and back
        // This is a workaround until we implement proper cache invalidation
        if (window.location.pathname === '/history') {
          // Navigate to dashboard to force portfolio refresh
          window.dispatchEvent(new CustomEvent('portfolio-needs-refresh'))
        }
      }, 500)
    } catch (err) {
      console.error(err)
      alert('Hubo un error al intentar borrar la operación.')
    } finally {
      setDeletingId(null)
    }
  }

  // --- CLOSED TRADES LOGIC ---
  const closedFiltered = closedTrades.filter(t =>
    !closedFilter || t.ticker.toLowerCase().includes(closedFilter.toLowerCase())
  )

  function handleClosedSort(key: ClosedSortKey) {
    if (closedSortKey === key) {
      setClosedSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setClosedSortKey(key)
      setClosedSortDir('desc')
    }
  }

  const closedSorted = [...closedFiltered].sort((a, b) => {
    let va: number | string = 0
    let vb: number | string = 0

    if (closedSortKey === 'ticker') {
      va = (a.ticker.split(':')[1] ?? a.ticker).toLowerCase()
      vb = (b.ticker.split(':')[1] ?? b.ticker).toLowerCase()
      return closedSortDir === 'asc' ? (va < vb ? -1 : 1) : (va > vb ? -1 : 1)
    }

    if (closedSortKey === 'open_date' || closedSortKey === 'close_date') {
      va = new Date((a as any)[closedSortKey]).getTime()
      vb = new Date((b as any)[closedSortKey]).getTime()
    } else {
      va = (a as any)[closedSortKey] ?? 0
      vb = (b as any)[closedSortKey] ?? 0
    }

    return closedSortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number)
  })

  // --- ALL TRANSACTIONS LOGIC ---
  const allFiltered = allTx.filter(t =>
    !allFilter || t.ticker.toLowerCase().includes(allFilter.toLowerCase())
  )

  function handleAllSort(key: AllSortKey) {
    // skip sorting if empty key
    if (!key) return
    
    if (allSortKey === key) {
      setAllSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setAllSortKey(key)
      setAllSortDir('desc')
    }
  }

  const allSorted = [...allFiltered].sort((a, b) => {
    let va: number | string = 0
    let vb: number | string = 0

    if (allSortKey === 'ticker' || allSortKey === 'operation') {
      va = ((a as any)[allSortKey] ?? '').toLowerCase()
      vb = ((b as any)[allSortKey] ?? '').toLowerCase()
      return allSortDir === 'asc' ? (va < vb ? -1 : 1) : (va > vb ? -1 : 1)
    }

    if (allSortKey === 'date' || allSortKey === 'created_at') {
      va = new Date((a as any)[allSortKey]).getTime()
      vb = new Date((b as any)[allSortKey]).getTime()
    } else {
      va = (a as any)[allSortKey] ?? 0
      vb = (b as any)[allSortKey] ?? 0
    }

    return allSortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number)
  })

  // Derived
  const totalPnl = closedTrades.reduce((s, t) => s + t.pnl, 0)
  const totalInvested = closedTrades.reduce((s, t) => s + t.invested, 0)
  const winners = closedTrades.filter(t => t.pnl > 0)
  const winRate = closedTrades.length > 0 ? winners.length / closedTrades.length : 0

  function ClosedSortIcon({ colKey }: { colKey: ClosedSortKey }) {
    if (closedSortKey !== colKey) return <ChevronDown className="w-3 h-3 text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity" />
    return closedSortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-amber" />
      : <ChevronDown className="w-3 h-3 text-amber" />
  }

  function AllSortIcon({ colKey }: { colKey: AllSortKey }) {
    if (!colKey) return null
    if (allSortKey !== colKey) return <ChevronDown className="w-3 h-3 text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity" />
    return allSortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-amber" />
      : <ChevronDown className="w-3 h-3 text-amber" />
  }

  return (
    <div className="min-h-screen md:pl-56 pb-20 md:pb-0">
      <div className="max-w-7xl mx-auto px-6 py-8">

        <div className="mb-6 animate-fade-in flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="font-display font-800 text-3xl text-white tracking-tight">
              Historial
              <span className="text-amber text-glow-amber"> de Operaciones</span>
            </h1>
            <p className="text-slate-500 font-mono text-sm mt-1">Revisá el rendimiento y todas tus compras/ventas</p>
          </div>
          
          <div className="flex bg-white/[0.03] p-1 rounded-xl border border-white/[0.05]">
            <button
              onClick={() => setActiveTab('closed')}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-display font-600 transition-all',
                activeTab === 'closed' ? 'bg-amber/10 text-amber' : 'text-slate-400 hover:text-white'
              )}
            >
              Posiciones Cerradas
            </button>
            <button
              onClick={() => setActiveTab('all')}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-display font-600 transition-all',
                activeTab === 'all' ? 'bg-amber/10 text-amber' : 'text-slate-400 hover:text-white'
              )}
            >
              Todas las Operaciones
            </button>
          </div>
        </div>

        {/* --- CLOSED TRADES TAB --- */}
        {activeTab === 'closed' && (
          <div className="animate-fade-in">
            {/* Summary KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              {[
                { label: 'P&L Realizado',  value: totalPnl,      highlight: true,  type: 'currency' as const },
                { label: 'Capital Rotado', value: totalInvested,  highlight: false, type: 'currency' as const },
                { label: 'Win Rate',       value: winRate,        highlight: false, type: 'percent'  as const },
                { label: 'Operaciones',    value: closedTrades.length,  highlight: false, type: 'number'   as const },
              ].map((k, i) => (
                <div key={i} className="kpi-card animate-slide-up"
                     style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'both' }}>
                  <span className="text-[11px] font-mono text-slate-500 uppercase tracking-widest">{k.label}</span>
                  <span className={cn(
                    'text-2xl font-display font-800 mt-1',
                    k.highlight ? (k.value >= 0 ? 'text-emerald' : 'text-rose') : 'text-white'
                  )}>
                    {k.type === 'currency' ? formatUSD(k.value)
                     : k.type === 'percent' ? formatPct(k.value)
                     : k.value.toString()}
                  </span>
                </div>
              ))}
            </div>

            {/* Filter */}
            <div className="mb-4">
              <input type="text" placeholder="Filtrar por ticker..."
                value={closedFilter} onChange={e => setClosedFilter(e.target.value)}
                className="input-field w-full sm:w-64" />
            </div>

            <div className="glass rounded-2xl overflow-hidden">
              {/* DESKTOP TABLE */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.04]">
                      {CLOSED_COLUMNS.map(col => (
                        <th
                          key={col.key}
                          onClick={() => handleClosedSort(col.key)}
                          className="group text-left px-4 py-3 text-[10px] font-mono text-slate-600 uppercase tracking-widest whitespace-nowrap cursor-pointer select-none hover:text-slate-400 transition-colors"
                        >
                          <span className="inline-flex items-center gap-1">
                            {col.label}
                            <ClosedSortIcon colKey={col.key} />
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {closedLoading ? (
                      <tr><td colSpan={11} className="text-center py-12">
                        <div className="w-6 h-6 border-2 border-amber/30 border-t-amber rounded-full animate-spin mx-auto" />
                      </td></tr>
                    ) : closedSorted.length === 0 ? (
                      <tr><td colSpan={11} className="text-center py-12 text-slate-600 font-mono text-sm">
                        Sin operaciones cerradas todavía
                      </td></tr>
                    ) : closedSorted.map((t, i) => {
                      const isPos = t.pnl > 0
                      return (
                        <tr key={t.id} className="table-row">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-600 text-sm text-white">
                                {t.ticker.split(':')[1] ?? t.ticker}
                              </span>
                              <span className="text-[9px] text-slate-600 font-mono">
                                {t.ticker.split(':')[0]}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-400">{formatDate(t.open_date)}</td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-400">{formatDate(t.close_date)}</td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-500">{t.days_held}d</td>
                          <td className="px-4 py-3 font-mono text-sm text-slate-400">{formatUSD(t.avg_cost)}</td>
                          <td className="px-4 py-3 font-mono text-sm text-slate-400">{formatUSD(t.close_price)}</td>
                          <td className="px-4 py-3 font-mono text-sm text-slate-400">
                            {t.quantity.toLocaleString('en-US', { maximumFractionDigits: 3 })}
                          </td>
                          <td className="px-4 py-3 font-mono text-sm text-slate-400">{formatUSD(t.invested)}</td>
                          <td className="px-4 py-3 font-mono text-sm text-white font-600">{formatUSD(t.proceeds)}</td>
                          <td className="px-4 py-3">
                            <span className={cn('font-mono text-sm font-600', isPos ? 'text-emerald' : 'text-rose')}>
                              {isPos ? '+' : ''}{formatUSD(t.pnl)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn(
                              'inline-flex items-center gap-1 text-xs font-mono font-600 px-2 py-0.5 rounded-full border',
                              isPos ? 'tag-positive' : 'tag-negative'
                            )}>
                              {isPos ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {formatPct(t.pnl_pct)}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* MOBILE CARDS */}
              <div className="flex md:hidden flex-col divide-y divide-white/[0.05]">
                {closedLoading ? (
                  <div className="py-12 flex justify-center">
                    <div className="w-6 h-6 border-2 border-amber/30 border-t-amber rounded-full animate-spin" />
                  </div>
                ) : closedSorted.length === 0 ? (
                  <div className="text-center py-10 text-slate-600 font-mono text-sm">
                    Sin operaciones cerradas
                  </div>
                ) : closedSorted.map((t) => {
                  const isPos = t.pnl > 0
                  return (
                    <div key={`mob-c-${t.id}`} className="p-4 flex flex-col gap-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-display font-800 text-lg text-white leading-none mb-1">
                            {t.ticker.split(':')[1] ?? t.ticker}
                          </p>
                          <p className="text-[10px] text-slate-500 font-mono">
                            {formatDate(t.open_date)} → {formatDate(t.close_date)} ({t.days_held}d)
                          </p>
                        </div>
                        <div className="text-right flex flex-col items-end">
                          <p className={cn('font-mono text-base font-600 mb-1.5', isPos ? 'text-emerald' : 'text-rose')}>
                            {isPos ? '+' : ''}{formatUSD(t.pnl)}
                          </p>
                          <span className={cn(
                            'inline-flex items-center gap-1 text-[11px] font-mono font-600 px-2 py-0.5 rounded-full border',
                            isPos ? 'tag-positive' : 'tag-negative'
                          )}>
                            {isPos ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {formatPct(t.pnl_pct)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* --- ALL TRANSACTIONS TAB --- */}
        {activeTab === 'all' && (
          <div className="animate-fade-in">
            {/* Filter */}
            <div className="mb-4">
              <input type="text" placeholder="Filtrar por ticker..."
                value={allFilter} onChange={e => setAllFilter(e.target.value)}
                className="input-field w-full sm:w-64" />
            </div>

            <div className="glass rounded-2xl overflow-hidden">
              {/* DESKTOP TABLE */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.04]">
                      {ALL_COLUMNS.map((col, idx) => (
                        <th
                          key={idx}
                          onClick={() => handleAllSort(col.key)}
                          className={cn(
                            "group text-left px-4 py-3 text-[10px] font-mono text-slate-600 uppercase tracking-widest whitespace-nowrap select-none transition-colors",
                            col.key ? "cursor-pointer hover:text-slate-400" : ""
                          )}
                        >
                          <span className="inline-flex items-center gap-1">
                            {col.label}
                            {col.key && <AllSortIcon colKey={col.key} />}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allLoading ? (
                      <tr><td colSpan={8} className="text-center py-12">
                        <div className="w-6 h-6 border-2 border-amber/30 border-t-amber rounded-full animate-spin mx-auto" />
                      </td></tr>
                    ) : allSorted.length === 0 ? (
                      <tr><td colSpan={8} className="text-center py-12 text-slate-600 font-mono text-sm">
                        No hay operaciones cargadas
                      </td></tr>
                    ) : allSorted.map((t) => (
                      <tr key={t.id} className="table-row group">
                        <td className="px-4 py-3 font-mono text-xs text-slate-400 whitespace-nowrap">{formatDate(t.date)}</td>
                        <td className="px-4 py-3">
                          <span className="font-mono font-600 text-sm text-white">
                            {t.ticker.split(':')[1] ?? t.ticker}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            'text-[10px] font-mono font-600 px-2 py-0.5 rounded-full bg-white/[0.03] border border-white/[0.05]',
                            t.operation === 'COMPRA' ? 'text-emerald' : t.operation === 'VENTA' ? 'text-rose' : 'text-blue-400'
                          )}>
                            {t.operation}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-sm text-white">
                          {t.quantity > 0 ? '+' : ''}{t.quantity.toLocaleString('en-US', { maximumFractionDigits: 6 })}
                        </td>
                        <td className="px-4 py-3 font-mono text-sm text-slate-400">{formatUSD(t.price)}</td>
                        <td className="px-4 py-3 font-mono text-sm text-slate-500">{t.commission ? formatUSD(t.commission) : '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600 whitespace-nowrap">
                          {new Date(t.created_at).toLocaleDateString('es-AR')}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleDelete(t.id)}
                            disabled={deletingId === t.id}
                            className="p-1.5 text-slate-600 hover:text-rose hover:bg-rose/10 rounded-md transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-50"
                            title="Eliminar operación"
                          >
                            {deletingId === t.id ? (
                              <div className="w-4 h-4 border-2 border-rose/30 border-t-rose rounded-full animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* MOBILE CARDS */}
              <div className="flex md:hidden flex-col divide-y divide-white/[0.05]">
                {allLoading ? (
                  <div className="py-12 flex justify-center">
                    <div className="w-6 h-6 border-2 border-amber/30 border-t-amber rounded-full animate-spin" />
                  </div>
                ) : allSorted.length === 0 ? (
                  <div className="text-center py-10 text-slate-600 font-mono text-sm">
                    No hay operaciones cargadas
                  </div>
                ) : allSorted.map((t) => (
                  <div key={`mob-a-${t.id}`} className="p-4 flex flex-col gap-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-display font-800 text-lg text-white leading-none">
                            {t.ticker.split(':')[1] ?? t.ticker}
                          </p>
                          <span className={cn(
                            'text-[9px] font-mono font-600 px-1.5 py-0.5 rounded-sm bg-white/[0.03] border border-white/[0.05]',
                            t.operation === 'COMPRA' ? 'text-emerald' : t.operation === 'VENTA' ? 'text-rose' : 'text-blue-400'
                          )}>
                            {t.operation}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 font-mono">
                          {formatDate(t.date)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm font-600 text-white mb-0.5">
                          {t.quantity > 0 ? '+' : ''}{t.quantity.toLocaleString('en-US', { maximumFractionDigits: 6 })}
                        </p>
                        <p className="text-[11px] text-slate-500 font-mono">
                          a {formatUSD(t.price)}
                        </p>
                      </div>
                    </div>
                    <div className="flex justify-end pt-2 border-t border-white/[0.05] mt-1">
                      <button
                        onClick={() => handleDelete(t.id)}
                        disabled={deletingId === t.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-600 text-slate-400 hover:text-rose bg-white/[0.02] hover:bg-rose/10 rounded-md transition-colors disabled:opacity-50"
                      >
                        {deletingId === t.id ? (
                          <div className="w-3 h-3 border-2 border-rose/30 border-t-rose rounded-full animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
