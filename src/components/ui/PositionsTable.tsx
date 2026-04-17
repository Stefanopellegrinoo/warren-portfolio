'use client'

import { useState } from 'react'
import { formatUSD, formatPct, cn } from '@/lib/utils'
import type { Position } from '@/types'
import { TrendingUp, TrendingDown, Minus, ChevronUp, ChevronDown, DollarSign } from 'lucide-react'

interface Props {
  positions: Position[]
  loading?: boolean
  summary?: any
  onSell?: (ticker: string, quantity: number, price: number) => void
}

type SortKey = 'ticker' | 'current_price' | 'quantity' | 'avg_cost' | 'total_invested' | 'market_value' | 'day_change' | 'day_change_pct' | 'pnl' | 'pnl_pct' | 'pct_cartera'
type SortDir = 'asc' | 'desc'

const COLUMNS: { label: string; key: SortKey | 'actions' }[] = [
  { label: 'TICKER',      key: 'ticker' },
  { label: 'PRECIO',      key: 'current_price' },
  { label: 'POSICIÓN',    key: 'quantity' },
  { label: 'COSTO PROM.', key: 'avg_cost' },
  { label: 'INVERTIDO',   key: 'total_invested' },
  { label: 'VALOR HOY',   key: 'market_value' },
  { label: 'P&L DÍA',     key: 'day_change' },
  { label: 'VAR. DÍA %',  key: 'day_change_pct' },
  { label: 'P&L USD',     key: 'pnl' },
  { label: 'P&L %',       key: 'pnl_pct' },
  { label: '% CARTERA',   key: 'pct_cartera' },
  { label: '',            key: 'actions' },
]

export default function PositionsTable({ positions, loading, summary, onSell }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('market_value')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null)
  const [lots, setLots] = useState<any[]>([])
  const [loadingLots, setLoadingLots] = useState(false)

  if (loading) return (
    <div className="glass rounded-2xl p-8 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-amber/30 border-t-amber rounded-full animate-spin" />
    </div>
  )

  const totalPortfolio = positions.reduce((s, p) => s + (p.market_value ?? 0), 0)

  function getPctCartera(pos: Position) {
    return totalPortfolio > 0 && pos.market_value ? pos.market_value / totalPortfolio : 0
  }

  async function toggleExpand(ticker: string) {
    if (expandedTicker === ticker) {
      setExpandedTicker(null)
      setLots([])
      return
    }

    setExpandedTicker(ticker)
    setLoadingLots(true)
    setLots([])

    try {
      const res = await fetch(`/api/positions/${encodeURIComponent(ticker)}/lots`)
      const data = await res.json()
      if (data.lots) {
        setLots(data.lots)
      }
    } catch (err) {
      console.error('Failed to fetch lots:', err)
    } finally {
      setLoadingLots(false)
    }
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = [...positions].sort((a, b) => {
    let va: number | string = 0
    let vb: number | string = 0

    if (sortKey === 'ticker') {
      va = (a.ticker.split(':')[1] ?? a.ticker).toLowerCase()
      vb = (b.ticker.split(':')[1] ?? b.ticker).toLowerCase()
      return sortDir === 'asc' ? (va < vb ? -1 : 1) : (va > vb ? -1 : 1)
    }

    if (sortKey === 'pct_cartera') {
      va = getPctCartera(a)
      vb = getPctCartera(b)
    } else {
      va = (a as any)[sortKey] ?? 0
      vb = (b as any)[sortKey] ?? 0
    }

    return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number)
  })

  function SortIcon({ colKey }: { colKey: SortKey }) {
    if (sortKey !== colKey) return <ChevronDown className="w-3 h-3 text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity" />
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-amber" />
      : <ChevronDown className="w-3 h-3 text-amber" />
  }

  return (
    <div className="glass rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.05]">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="font-display font-700 text-white">Posiciones Abiertas</h3>
            <p className="text-[11px] text-slate-500 font-mono mt-0.5">{positions.length} activos</p>
          </div>
        </div>
        {summary && (
          <div className="text-right">
            <div className="hidden md:block">
              <p className="text-[10px] font-mono text-slate-500 uppercase">Total Acá</p>
              <p className="font-mono font-700 text-white">{formatUSD(summary.market_value)}</p>
            </div>
            <div className="flex flex-col items-end gap-0.5 mt-1 md:mt-0">
              <div className="flex items-center gap-2">
                <span className={cn('text-[11px] font-mono', summary.pnl >= 0 ? 'text-emerald' : 'text-rose')}>
                  Histórico: {summary.pnl >= 0 ? '+' : ''}{formatUSD(summary.pnl)} ({formatPct(summary.pnl_pct)})
                </span>
                <span className="text-slate-600 hidden sm:inline">|</span>
                <span className={cn('text-[11px] font-mono', summary.day_pnl >= 0 ? 'text-emerald' : 'text-rose')}>
                  Diario: {summary.day_pnl >= 0 ? '+' : ''}{formatUSD(summary.day_pnl)} ({formatPct(summary.day_pnl_pct)})
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* --- DESKTOP VIEW (Table) --- */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.04]">
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  onClick={() => col.key !== 'actions' ? handleSort(col.key as SortKey) : undefined}
                  className={cn(
                    "group text-left px-3 py-3 text-[9px] font-mono text-slate-600 uppercase tracking-widest whitespace-nowrap select-none transition-colors",
                    col.key !== 'actions' ? "cursor-pointer hover:text-slate-400" : "cursor-default"
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.key !== 'actions' && <SortIcon colKey={col.key as SortKey} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-12 text-slate-600 font-mono text-sm">
                Sin posiciones abiertas · Agregá tu primera operación
              </td></tr>
            ) : sorted.map((pos, i) => {
              const hasPnl = pos.pnl !== undefined
              const isPos = (pos.pnl ?? 0) > 0
              const isNeg = (pos.pnl ?? 0) < 0
              const pctCartera = getPctCartera(pos)
              const isExpanded = expandedTicker === pos.ticker

              return (
                <>
                <tr key={pos.id}
                  onClick={() => toggleExpand(pos.ticker)}
                  className={cn(
                    "table-row animate-fade-in cursor-pointer hover:bg-white/[0.02] transition-colors",
                    isExpanded && "bg-white/[0.03]"
                  )}
                  style={{ animationDelay: `${i * 30}ms`, animationFillMode: 'both' }}>

                  {/* Ticker */}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "transition-transform duration-200",
                        isExpanded ? "rotate-180" : ""
                      )}>
                        <ChevronDown className="w-3.5 h-3.5 text-amber" />
                      </div>
                      <span className="font-mono font-600 text-sm text-white">
                        {pos.ticker.split(':')[1] ?? pos.ticker}
                      </span>
                      <span className="text-[9px] text-slate-600 font-mono hidden sm:block">
                        {pos.ticker.split(':')[0]}
                      </span>
                    </div>
                  </td>

                  {/* Precio */}
                  <td className="px-3 py-3 font-mono text-xs text-white">
                    {pos.current_price ? formatUSD(pos.current_price) : <span className="text-slate-600">—</span>}
                  </td>

                  {/* Posición */}
                  <td className="px-3 py-3 font-mono text-xs text-slate-400">
                    {pos.quantity.toLocaleString('en-US', { maximumFractionDigits: 3 })}
                  </td>

                  {/* Costo promedio */}
                  <td className="px-3 py-3 font-mono text-xs text-slate-400">
                    {formatUSD(pos.avg_cost)}
                  </td>

                  {/* Invertido */}
                  <td className="px-3 py-3 font-mono text-xs text-slate-400">
                    {formatUSD(pos.total_invested)}
                  </td>

                  {/* Valor hoy */}
                  <td className="px-3 py-3 font-mono text-xs font-600 text-white">
                    {pos.market_value ? formatUSD(pos.market_value) : <span className="text-slate-600">—</span>}
                  </td>

                  {/* P&L DÍA */}
                  <td className="px-3 py-3">
                    {pos.day_change !== undefined ? (
                      <span className={cn('font-mono text-xs font-600',
 pos.day_change > 0 ? 'text-emerald' : pos.day_change < 0 ? 'text-rose' : 'text-slate-400')}>
                        {pos.day_change > 0 ? '+' : ''}{formatUSD(pos.day_change)}
                      </span>
                    ) : <span className="text-slate-600">—</span>}
                  </td>

                  {/* VAR. DÍA % */}
                  <td className="px-3 py-3">
                    {pos.day_change_pct !== undefined ? (
                      <span className={cn(
                        'inline-flex items-center gap-1 text-xs font-mono font-600 px-2 py-0.5 rounded-full border',
                        pos.day_change_pct > 0 ? 'tag-positive' : pos.day_change_pct < 0 ? 'tag-negative' : 'tag-neutral'
                      )}>
                        {pos.day_change_pct > 0 ? <TrendingUp className="w-3 h-3" /> : pos.day_change_pct < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                        {formatPct(pos.day_change_pct)}
                      </span>
                    ) : <span className="text-slate-600">—</span>}
                  </td>

                  {/* P&L USD */}
                  <td className="px-3 py-3">
                    {hasPnl ? (
                      <span className={cn('font-mono text-xs font-600',
 isPos ? 'text-emerald' : isNeg ? 'text-rose' : 'text-slate-400')}>
                        {isPos ? '+' : ''}{formatUSD(pos.pnl!)}
                      </span>
                    ) : <span className="text-slate-600">—</span>}
                  </td>

                  {/* P&L % */}
                  <td className="px-3 py-3">
                    {pos.pnl_pct !== undefined ? (
                      <span className={cn(
                        'inline-flex items-center gap-1 text-xs font-mono font-600 px-2 py-0.5 rounded-full border',
                        isPos ? 'tag-positive' : isNeg ? 'tag-negative' : 'tag-neutral'
                      )}>
                        {isPos ? <TrendingUp className="w-3 h-3" /> : isNeg ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                        {formatPct(pos.pnl_pct)}
                      </span>
                    ) : <span className="text-slate-600">—</span>}
                  </td>

                  {/* % Cartera */}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1 bg-bg-600 rounded-full overflow-hidden">
                        <div className="h-full bg-amber rounded-full" style={{ width: `${Math.min(pctCartera * 100, 100)}%` }} />
                      </div>
                      <span className="font-mono text-xs text-slate-500">
                        {(pctCartera * 100).toFixed(1)}%
                      </span>
                    </div>
                  </td>

                  {/* Quick Actions */}
                  <td className="px-3 py-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onSell?.(pos.ticker, pos.quantity, pos.current_price ?? 0)
                      }}
                      className="p-1.5 rounded-lg bg-rose/10 text-rose hover:bg-rose/20 transition-colors border border-rose/20 group/btn"
                      title="Vender"
                    >
                      <DollarSign className="w-3.5 h-3.5 group-hover/btn:scale-110 transition-transform" />
                    </button>
                  </td>
                </tr>

                {/* Sub-row for Lots */}
                {isExpanded && (
                  <tr className="bg-white/[0.015] border-b border-white/[0.05]">
                    <td colSpan={11} className="p-0">
                      <div className="px-12 py-3">
                        <div className="border-l-2 border-amber/20 pl-4">
                          {loadingLots ? (
                            <div className="flex py-4 justify-center">
                              <div className="w-4 h-4 border-2 border-amber/20 border-t-amber rounded-full animate-spin" />
                            </div>
                          ) : lots.length === 0 ? (
                            <p className="text-[11px] text-slate-600 font-mono py-2">No se encontraron compras activas.</p>
                          ) : (
                            <table className="w-full">
                              <thead>
                                <tr className="text-[9px] font-mono text-slate-600 uppercase">
                                  <th className="text-left py-1">Fecha</th>
                                  <th className="text-right py-1">Cant.</th>
                                  <th className="text-right py-1">Precio Compra</th>
                                  <th className="text-right py-1">PnL USD</th>
                                  <th className="text-right py-1">PnL %</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-white/[0.03]">
                                {lots.map((lot) => (
                                  <tr key={lot.id} className="text-[11px] font-mono group hover:bg-white/[0.01] transition-colors">
                                    <td className="py-1.5 text-slate-400">{new Date(lot.date).toLocaleDateString('es-AR')}</td>
                                    <td className="py-1.5 text-right text-slate-300">{lot.quantity.toLocaleString('en-US', { maximumFractionDigits: 3 })}</td>
                                    <td className="py-1.5 text-right text-slate-300">{formatUSD(lot.buy_price)}</td>
                                    <td className={cn(
                                      "py-1.5 text-right font-600",
                                      lot.pnl >= 0 ? "text-emerald/80" : "text-rose/80"
                                    )}>
                                      {lot.pnl >= 0 ? '+' : ''}{formatUSD(lot.pnl)}
                                    </td>
                                    <td className={cn(
                                      "py-1.5 text-right font-600",
                                      lot.pnl >= 0 ? "text-emerald/80" : "text-rose/80"
                                    )}>
                                      {formatPct(lot.pnl_pct)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* --- MOBILE VIEW (table row - equal spacing, no yellow dot) --- */}
      <div className="flex flex-col md:hidden">
        {/* Header row */}
        <div className="flex items-center px-2 py-2 border-b border-white/[0.06] bg-white/[0.02]">
          <button onClick={() => handleSort('ticker')} className="flex-1 flex items-center justify-start px-1">
            <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">Ticker</span>
            <SortIcon colKey="ticker" />
          </button>
          <button onClick={() => handleSort('market_value')} className="flex-1 flex items-center justify-end px-1">
            <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">Valor</span>
            <SortIcon colKey="market_value" />
          </button>
          <button onClick={() => handleSort('day_change_pct')} className="flex-1 flex items-center justify-end px-1">
            <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">Var %</span>
            <SortIcon colKey="day_change_pct" />
          </button>
          <button onClick={() => handleSort('pnl')} className="flex-1 flex items-center justify-end px-1">
            <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">P&L USD</span>
            <SortIcon colKey="pnl" />
          </button>
          <button onClick={() => handleSort('pnl_pct')} className="flex-1 flex items-center justify-end px-1">
            <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">P&L %</span>
            <SortIcon colKey="pnl_pct" />
          </button>
        </div>

        {/* Data rows */}
        <div className="divide-y divide-white/[0.04]">
          {sorted.length === 0 ? (
            <div className="text-center py-6 text-slate-400 text-xs font-sans">
              Sin posiciones abiertas
            </div>
          ) : sorted.map((pos, i) => {
            const isPosPnl = (pos.pnl ?? 0) > 0
            const isNegPnl = (pos.pnl ?? 0) < 0
            const isPosDay = (pos.day_change ?? 0) > 0
            const isNegDay = (pos.day_change ?? 0) < 0
            const isExpanded = expandedTicker === pos.ticker

            return (
              <div key={`mob-wrap-${pos.id}`}>
                <div
                  onClick={() => toggleExpand(pos.ticker)}
                  className={cn(
                    "flex items-center px-2 py-1.5 animate-fade-in font-sans cursor-pointer",
                    isExpanded && "bg-white/[0.03]"
                  )}
                  style={{ animationDelay: `${i * 10}ms`, animationFillMode: 'both' }}
                >
                  {/* Ticker */}
                  <div className="flex-1 px-0.5 flex items-center gap-1.5 overflow-hidden">
                    <ChevronDown className={cn("w-3 h-3 text-amber shrink-0 transition-transform", isExpanded && "rotate-180")} />
                    <span className="text-xs font-semibold text-white truncate tracking-tight shrink-0">
                      {pos.ticker.split(':')[1] ?? pos.ticker}
                    </span>
                  </div>

                  {/* Valor Actual - sin decimales */}
                  <div className="flex-1 px-1.5 text-right">
                    <span className="text-xs font-medium tabular-nums text-white">
                      {pos.market_value !== undefined ? `$${Math.round(pos.market_value).toLocaleString('en-US')}` : '—'}
                    </span>
                  </div>

                  {/* VAR. DÍA % - 1 decimal */}
                  <div className="flex-1 px-1.5 text-right">
                    <span className={cn('text-xs font-medium tabular-nums', isPosDay ? 'text-emerald' : isNegDay ? 'text-rose' : 'text-slate-400')}>
                      {pos.day_change_pct !== undefined ? `${(pos.day_change_pct * 100).toFixed(1)}%` : '—'}
                    </span>
                  </div>

                  {/* P&L USD - sin decimales */}
                  <div className="flex-1 px-1.5 text-right">
                    <span className={cn('text-xs font-medium tabular-nums', isPosPnl ? 'text-emerald' : isNegPnl ? 'text-rose' : 'text-slate-400')}>
                      {pos.pnl !== undefined ? `${pos.pnl > 0 ? '+' : ''}$${Math.round(pos.pnl).toLocaleString('en-US')}` : '—'}
                    </span>
                  </div>

                  {/* P&L % - 1 decimal */}
                  <div className="flex-1 px-1.5 text-right flex items-center justify-end gap-1">
                    <span className={cn('text-xs font-medium tabular-nums', isPosPnl ? 'text-emerald' : isNegPnl ? 'text-rose' : 'text-slate-400')}>
                      {pos.pnl_pct !== undefined ? `${(pos.pnl_pct * 100).toFixed(1)}%` : '—'}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onSell?.(pos.ticker, pos.quantity, pos.current_price ?? 0)
                      }}
                      className="p-1 rounded-md bg-rose/10 text-rose border border-rose/20 shrink-0 ml-1"
                    >
                      <DollarSign className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>

                {/* Mobile Expansion */}
                {isExpanded && (
                  <div className="px-2 py-2 bg-white/[0.015] border-y border-white/[0.05] animate-slide-down">
                    {loadingLots ? (
                       <div className="py-2 flex justify-center"><div className="w-3 h-3 border border-amber/20 border-t-amber rounded-full animate-spin" /></div>
                    ) : lots.length === 0 ? (
                      <p className="text-[10px] text-slate-600 font-mono italic px-2">Sin compras activas</p>
                    ) : (
                      <div className="space-y-1.5">
                        {lots.map(lot => (
                          <div key={lot.id} className="flex items-center text-[9px] font-mono">
                            <div className="flex-1 px-1 text-left text-slate-500">
                              {new Date(lot.date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                            </div>
                            <div className="flex-1 px-1 text-right text-slate-400">
                              {lot.quantity.toLocaleString('en-US', { maximumFractionDigits: 1 })}
                            </div>
                            <div className="flex-1 px-1 text-right text-slate-400">
                              {Math.round(lot.buy_price).toLocaleString('en-US')}
                            </div>
                            <div className={cn("flex-1 px-1 text-right font-600", lot.pnl >= 0 ? "text-emerald/70" : "text-rose/70")}>
                              {lot.pnl >= 0 ? '+' : ''}{Math.round(lot.pnl).toLocaleString('en-US')}
                            </div>
                            <div className={cn("flex-1 px-1 text-right font-600", lot.pnl >= 0 ? "text-emerald/70" : "text-rose/70")}>
                              {(lot.pnl_pct * 100).toFixed(1)}%
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
