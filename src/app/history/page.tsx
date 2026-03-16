'use client'

import { useState, useEffect, useCallback } from 'react'
import { formatUSD, formatPct, formatDate, cn } from '@/lib/utils'
import type { ClosedTrade } from '@/types'
import { TrendingUp, TrendingDown, ChevronUp, ChevronDown } from 'lucide-react'

type SortKey = 'ticker' | 'open_date' | 'close_date' | 'days_held' | 'avg_cost' | 'close_price' | 'quantity' | 'invested' | 'proceeds' | 'pnl' | 'pnl_pct'
type SortDir = 'asc' | 'desc'

const COLUMNS: { label: string; key: SortKey }[] = [
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

export default function HistoryPage() {
  const [trades, setTrades] = useState<ClosedTrade[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('close_date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const fetchClosedTrades = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/transactions/closed')
      const data = await res.json()
      setTrades(data.data ?? [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchClosedTrades() }, [fetchClosedTrades])

  const filtered = trades.filter(t =>
    !filter || t.ticker.toLowerCase().includes(filter.toLowerCase())
  )

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = [...filtered].sort((a, b) => {
    let va: number | string = 0
    let vb: number | string = 0

    if (sortKey === 'ticker') {
      va = (a.ticker.split(':')[1] ?? a.ticker).toLowerCase()
      vb = (b.ticker.split(':')[1] ?? b.ticker).toLowerCase()
      return sortDir === 'asc' ? (va < vb ? -1 : 1) : (va > vb ? -1 : 1)
    }

    if (sortKey === 'open_date' || sortKey === 'close_date') {
      va = new Date((a as any)[sortKey]).getTime()
      vb = new Date((b as any)[sortKey]).getTime()
    } else {
      va = (a as any)[sortKey] ?? 0
      vb = (b as any)[sortKey] ?? 0
    }

    return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number)
  })

  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
  const totalInvested = trades.reduce((s, t) => s + t.invested, 0)
  const winners = trades.filter(t => t.pnl > 0)
  const winRate = trades.length > 0 ? winners.length / trades.length : 0

  function SortIcon({ colKey }: { colKey: SortKey }) {
    if (sortKey !== colKey) return <ChevronDown className="w-3 h-3 text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity" />
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-amber" />
      : <ChevronDown className="w-3 h-3 text-amber" />
  }

  return (
    <div className="min-h-screen md:pl-56 pb-20 md:pb-0">
      <div className="max-w-7xl mx-auto px-6 py-8">

        <div className="mb-8 animate-fade-in">
          <h1 className="font-display font-800 text-3xl text-white tracking-tight">
            Historial
            <span className="text-amber text-glow-amber"> Cerrado</span>
          </h1>
          <p className="text-slate-500 font-mono text-sm mt-1">Todas las posiciones ya cerradas</p>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'P&L Realizado',  value: totalPnl,      highlight: true,  type: 'currency' as const },
            { label: 'Capital Rotado', value: totalInvested,  highlight: false, type: 'currency' as const },
            { label: 'Win Rate',       value: winRate,        highlight: false, type: 'percent'  as const },
            { label: 'Operaciones',    value: trades.length,  highlight: false, type: 'number'   as const },
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
            value={filter} onChange={e => setFilter(e.target.value)}
            className="input-field w-64" />
        </div>

        {/* Table & Mobile Cards */}
        <div className="glass rounded-2xl overflow-hidden">
          {/* DESKTOP TABLE */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.04]">
                  {COLUMNS.map(col => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className="group text-left px-4 py-3 text-[10px] font-mono text-slate-600 uppercase tracking-widest whitespace-nowrap cursor-pointer select-none hover:text-slate-400 transition-colors"
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        <SortIcon colKey={col.key} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={11} className="text-center py-12">
                    <div className="w-6 h-6 border-2 border-amber/30 border-t-amber rounded-full animate-spin mx-auto" />
                  </td></tr>
                ) : sorted.length === 0 ? (
                  <tr><td colSpan={11} className="text-center py-12 text-slate-600 font-mono text-sm">
                    Sin operaciones cerradas todavía
                  </td></tr>
                ) : sorted.map((t, i) => {
                  const isPos = t.pnl > 0
                  return (
                    <tr key={t.id} className="table-row animate-fade-in"
                        style={{ animationDelay: `${i * 20}ms`, animationFillMode: 'both' }}>
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
                          {isPos
                            ? <TrendingUp className="w-3 h-3" />
                            : <TrendingDown className="w-3 h-3" />}
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
            {loading ? (
              <div className="py-12 flex justify-center">
                <div className="w-6 h-6 border-2 border-amber/30 border-t-amber rounded-full animate-spin" />
              </div>
            ) : sorted.length === 0 ? (
              <div className="text-center py-10 text-slate-600 font-mono text-sm">
                Sin operaciones cerradas
              </div>
            ) : sorted.map((t, i) => {
              const isPos = t.pnl > 0
              return (
                <div key={`mob-${t.id}`} className="p-4 animate-fade-in flex flex-col gap-3" style={{ animationDelay: `${i * 20}ms`, animationFillMode: 'both' }}>
                  
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <p className="font-display font-800 text-lg text-white leading-none">
                          {t.ticker.split(':')[1] ?? t.ticker}
                        </p>
                      </div>
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
    </div>
  )
}
