'use client'

import { formatUSD, formatPct, cn } from '@/lib/utils'
import type { Position } from '@/types'
import { TrendingUp, TrendingDown, Minus, RefreshCw } from 'lucide-react'

interface Props {
  positions: Position[]
  loading?: boolean
  onRefresh?: () => void
}

export default function PositionsTable({ positions, loading, onRefresh }: Props) {
  if (loading) return (
    <div className="glass rounded-2xl p-8 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-amber/30 border-t-amber rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="glass rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.05]">
        <div>
          <h3 className="font-display font-700 text-white">Posiciones Abiertas</h3>
          <p className="text-[11px] text-slate-500 font-mono mt-0.5">{positions.length} activos · Costo promedio calculado con algoritmo móvil</p>
        </div>
        {onRefresh && (
          <button onClick={onRefresh}
            className="text-slate-600 hover:text-amber transition-colors p-1.5 rounded-lg hover:bg-amber/10">
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* --- DESKTOP VIEW (Table) --- */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.04]">
              {['TICKER', 'PRECIO', 'POSICIÓN', 'COSTO PROM.', 'INVERTIDO', 'VALOR HOY', 'P&L DÍA', 'VAR. DÍA %', 'P&L USD', 'P&L %', '% CARTERA'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-[10px] font-mono text-slate-600 uppercase tracking-widest whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-12 text-slate-600 font-mono text-sm">
                Sin posiciones abiertas · Agregá tu primera operación
              </td></tr>
            ) : positions.map((pos, i) => {
              const hasPnl = pos.pnl !== undefined
              const isPos = (pos.pnl ?? 0) > 0
              const isNeg = (pos.pnl ?? 0) < 0
              const totalPortfolio = positions.reduce((s, p) => s + (p.market_value ?? 0), 0)
              const pctCartera = totalPortfolio > 0 && pos.market_value ? pos.market_value / totalPortfolio : 0

              return (
                <tr key={pos.id}
                  className="table-row animate-fade-in"
                  style={{ animationDelay: `${i * 30}ms`, animationFillMode: 'both' }}>

                  {/* Ticker */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber animate-pulse-slow" />
                      <span className="font-mono font-600 text-sm text-white">
                        {pos.ticker.split(':')[1] ?? pos.ticker}
                      </span>
                      <span className="text-[9px] text-slate-600 font-mono hidden sm:block">
                        {pos.ticker.split(':')[0]}
                      </span>
                    </div>
                  </td>

                  {/* Precio */}
                  <td className="px-4 py-3 font-mono text-sm text-white">
                    {pos.current_price ? formatUSD(pos.current_price) : <span className="text-slate-600">—</span>}
                  </td>

                  {/* Posición */}
                  <td className="px-4 py-3 font-mono text-sm text-slate-400">
                    {pos.quantity.toLocaleString('en-US', { maximumFractionDigits: 3 })}
                  </td>

                  {/* Costo promedio */}
                  <td className="px-4 py-3 font-mono text-sm text-slate-400">
                    {formatUSD(pos.avg_cost)}
                  </td>

                  {/* Invertido */}
                  <td className="px-4 py-3 font-mono text-sm text-slate-400">
                    {formatUSD(pos.total_invested)}
                  </td>

                  {/* Valor hoy */}
                  <td className="px-4 py-3 font-mono text-sm font-600 text-white">
                    {pos.market_value ? formatUSD(pos.market_value) : <span className="text-slate-600">—</span>}
                  </td>

                  {/* P&L DÍA */}
                  <td className="px-4 py-3">
                    {pos.day_change !== undefined ? (
                      <span className={cn('font-mono text-sm font-600', pos.day_change > 0 ? 'text-emerald' : pos.day_change < 0 ? 'text-rose' : 'text-slate-400')}>
                        {pos.day_change > 0 ? '+' : ''}{formatUSD(pos.day_change)}
                      </span>
                    ) : <span className="text-slate-600">—</span>}
                  </td>

                  {/* VAR. DÍA % */}
                  <td className="px-4 py-3">
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
                  <td className="px-4 py-3">
                    {hasPnl ? (
                      <span className={cn('font-mono text-sm font-600', isPos ? 'text-emerald' : isNeg ? 'text-rose' : 'text-slate-400')}>
                        {isPos ? '+' : ''}{formatUSD(pos.pnl!)}
                      </span>
                    ) : <span className="text-slate-600">—</span>}
                  </td>

                  {/* P&L % */}
                  <td className="px-4 py-3">
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
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1 bg-bg-600 rounded-full overflow-hidden">
                        <div className="h-full bg-amber rounded-full" style={{ width: `${Math.min(pctCartera * 100, 100)}%` }} />
                      </div>
                      <span className="font-mono text-xs text-slate-500">
                        {(pctCartera * 100).toFixed(1)}%
                      </span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* --- MOBILE VIEW (Cards) --- */}
      <div className="flex flex-col md:hidden divide-y divide-white/[0.05]">
        {positions.length === 0 ? (
          <div className="text-center py-10 text-slate-600 font-mono text-sm">
            Sin posiciones abiertas
          </div>
        ) : positions.map((pos, i) => {
          const hasPnl = pos.pnl !== undefined
          const isPos = (pos.pnl ?? 0) > 0
          const isNeg = (pos.pnl ?? 0) < 0
          const totalPortfolio = positions.reduce((s, p) => s + (p.market_value ?? 0), 0)
          const pctCartera = totalPortfolio > 0 && pos.market_value ? pos.market_value / totalPortfolio : 0

          return (
            <div key={`mob-${pos.id}`} className="p-4 animate-fade-in flex items-center justify-between" style={{ animationDelay: `${i * 30}ms`, animationFillMode: 'both' }}>
              
              {/* Left Column: Ticker & Position */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber animate-pulse-slow" />
                  <p className="font-display font-800 text-lg text-white leading-none">
                    {pos.ticker.split(':')[1] ?? pos.ticker}
                  </p>
                </div>
                <p className="text-[11px] text-slate-500 font-mono">
                  {pos.quantity.toLocaleString('en-US', { maximumFractionDigits: 3 })} nom.
                </p>
              </div>

              {/* Right Column: Value & Badge */}
              <div className="text-right flex flex-col items-end">
                <p className="font-mono text-base font-600 text-white mb-1.5">
                  {pos.market_value ? formatUSD(pos.market_value) : <span className="text-slate-600">—</span>}
                </p>

                {pos.pnl_pct !== undefined ? (
                  <span className={cn(
                    'inline-flex items-center gap-1 text-[11px] font-mono font-600 px-2 py-0.5 rounded-full border',
                    isPos ? 'tag-positive' : isNeg ? 'tag-negative' : 'tag-neutral'
                  )}>
                    {isPos ? <TrendingUp className="w-3 h-3" /> : isNeg ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                    {formatPct(pos.pnl_pct)}
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-600 border border-white/5 rounded-full px-2 py-0.5">N/A</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
