'use client'

import { useState, useEffect, useCallback } from 'react'
import { formatUSD, formatPct, formatDate, cn } from '@/lib/utils'
import type { ClosedTrade } from '@/types'
import { TrendingUp, TrendingDown } from 'lucide-react'

export default function HistoryPage() {
  const [trades, setTrades] = useState<ClosedTrade[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

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

  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
  const totalInvested = trades.reduce((s, t) => s + t.invested, 0)
  const winners = trades.filter(t => t.pnl > 0)
  const winRate = trades.length > 0 ? winners.length / trades.length : 0

  return (
    <div className="min-h-screen pl-56">
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

        {/* Table */}
        <div className="glass rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.04]">
                  {['TICKER','COMPRA','VENTA','DÍAS','COSTO PROM.','PRECIO CIERRE','CANTIDAD','INVERTIDO','RETORNO','P&L USD','P&L %'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[10px] font-mono text-slate-600 uppercase tracking-widest whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={11} className="text-center py-12">
                    <div className="w-6 h-6 border-2 border-amber/30 border-t-amber rounded-full animate-spin mx-auto" />
                  </td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={11} className="text-center py-12 text-slate-600 font-mono text-sm">
                    Sin operaciones cerradas todavía
                  </td></tr>
                ) : filtered.map((t, i) => {
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
        </div>

      </div>
    </div>
  )
}
