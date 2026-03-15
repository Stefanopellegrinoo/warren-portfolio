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

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.04]">
              {['TICKER', 'PRECIO', 'POSICIÓN', 'COSTO PROM.', 'INVERTIDO', 'VALOR HOY', 'P&L USD', 'P&L %', '% CARTERA'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-[10px] font-mono text-slate-600 uppercase tracking-widest whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-12 text-slate-600 font-mono text-sm">
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
    </div>
  )
}
