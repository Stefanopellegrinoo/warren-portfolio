'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Upload } from 'lucide-react'
import KpiCard from '@/components/ui/KpiCard'
import PositionsTable from '@/components/ui/PositionsTable'
import AddTransactionModal from '@/components/ui/AddTransactionModal'
import ImportModal from '@/components/ui/ImportModal'
import type { Position, PortfolioSummary } from '@/types'
import { formatUSD } from '@/lib/utils'

const REFRESH_INTERVAL_SEC = 300 // 5 minutes — matches worker cycle

export default function DashboardPage() {
  const [positions, setPositions] = useState<Position[]>([])
  const [summary, setSummary] = useState<PortfolioSummary | null>(null)
  const [positionsLoading, setPositionsLoading] = useState(true)
  const [showAddTx, setShowAddTx] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<string | null>(null) // Server timestamp string
  
  // Use refs instead of state for countdown to avoid unnecessary re-renders
  const countdownRef = useRef(REFRESH_INTERVAL_SEC)
  const [displayCountdown, setDisplayCountdown] = useState(REFRESH_INTERVAL_SEC)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchPositionsData = useCallback(async () => {
    setPositionsLoading(true)
    try {
      const res = await fetch('/api/positions')
      const posData = await res.json()
      setPositions(posData.positions ?? [])
      setSummary(posData.summary ?? null)

      // Sync countdown with server's last refresh timestamp
      if (posData.lastRefresh) {
        setLastUpdate(posData.lastRefresh) // Store server timestamp directly
        const last = new Date(posData.lastRefresh)
        const now = new Date()
        const elapsed = Math.floor((now.getTime() - last.getTime()) / 1000)
        const remaining = Math.max(1, REFRESH_INTERVAL_SEC - (elapsed % REFRESH_INTERVAL_SEC))
        countdownRef.current = remaining
        setDisplayCountdown(remaining)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setPositionsLoading(false)
    }
  }, [])

  // Full refresh helper for buttons
  const fetchAllData = useCallback(async () => {
    await Promise.all([fetchPositionsData()])
  }, [fetchPositionsData])

  // Initial load
  useEffect(() => { fetchPositionsData() }, [fetchPositionsData])

  // Auto-refresh countdown — uses a stable interval that doesn't depend on fetchAllData
  useEffect(() => {
    if (!autoRefresh) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }

    intervalRef.current = setInterval(() => {
      countdownRef.current -= 1
      setDisplayCountdown(countdownRef.current)
      
      if (countdownRef.current <= 0) {
        countdownRef.current = REFRESH_INTERVAL_SEC
        setDisplayCountdown(REFRESH_INTERVAL_SEC)
        fetchPositionsData()
      }
    }, 1000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh])

  // Derived analytics
  const totalMarketValue = summary?.total_market_value ?? 0
  const topHolding = positions.length > 0
    ? [...positions].sort((a, b) => (b.market_value ?? 0) - (a.market_value ?? 0))[0]
    : null
  const topConcentration = topHolding && totalMarketValue > 0
    ? ((topHolding.market_value ?? 0) / totalMarketValue * 100).toFixed(1)
    : '0'
  const top3Value = [...positions]
    .sort((a, b) => (b.market_value ?? 0) - (a.market_value ?? 0))
    .slice(0, 3)
    .reduce((s, p) => s + (p.market_value ?? 0), 0)
  const top3Pct = totalMarketValue > 0 ? (top3Value / totalMarketValue * 100).toFixed(1) : '0'

  // Format the server timestamp for display
  const lastUpdateDisplay = lastUpdate
    ? new Date(lastUpdate).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  return (
    <div className="min-h-screen md:pl-56 pb-20 md:pb-0">
      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8 animate-fade-in">
          <div>
            <h1 className="font-display font-800 text-2xl md:text-3xl text-white tracking-tight">
              Portfolio
              <span className="text-amber text-glow-amber"> Overview</span>
            </h1>
            <div className="flex items-center gap-3 mt-1">
              <p className="text-slate-500 font-mono text-sm hidden sm:block">
                {new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
              {/* Live indicator */}
              <button
                onClick={() => setAutoRefresh(a => !a)}
                className={`flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded-full border transition-all duration-200 ${
                  autoRefresh
                    ? 'bg-emerald/10 text-emerald border-emerald/30 hover:bg-emerald/20'
                    : 'bg-slate-500/10 text-slate-500 border-slate-500/20 hover:bg-slate-500/20'
                }`}
                title={autoRefresh ? `Auto-refresh en ${displayCountdown}s — click para pausar` : 'Click para activar auto-refresh'}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-emerald animate-pulse' : 'bg-slate-500'}`} />
                <span className="hidden sm:inline">{autoRefresh ? `LIVE · ${displayCountdown}s` : 'PAUSED'}</span>
                <span className="sm:hidden">{autoRefresh ? 'LIVE' : 'PAUSED'}</span>
              </button>
              {lastUpdateDisplay && (
                <span className="text-[10px] text-slate-600 font-mono hidden sm:inline">
                  Últ. cotización: {lastUpdateDisplay}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <button onClick={() => setShowImport(true)}
              className="btn-ghost flex-1 sm:flex-none justify-center flex items-center gap-2 text-xs">
              <Upload className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              <span className="hidden md:inline">Importar Excel</span>
            </button>
            <button onClick={() => setShowAddTx(true)}
              className="btn-primary flex-1 sm:flex-none justify-center flex items-center gap-2 text-xs whitespace-nowrap">
              <Plus className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              <span className="hidden md:inline">Nueva Operación</span>
            </button>
          </div>
        </div>

        {/* KPI Grid — Row 1 */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
          <div className="col-span-2 lg:col-span-1">
            <KpiCard
              label="Valor de Mercado"
              value={summary?.total_market_value ?? 0}
              subValue={`${summary?.positions_count ?? 0} posiciones`}
              delay={0}
            />
          </div>
          <KpiCard
            label="Capital Invertido"
            value={summary?.total_invested ?? 0}
            delay={60}
          />
          <KpiCard
            label="P&L Diario"
            value={summary?.day_pnl ?? 0}
            highlight
            subValue={summary?.day_pnl_pct !== undefined ? ((summary.day_pnl_pct * 100).toFixed(2) + '%') : undefined}
            delay={120}
          />
          <KpiCard
            label="P&L Abierto"
            value={summary?.open_pnl ?? 0}
            highlight
            subValue={summary?.open_pnl_pct !== undefined ? formatUSD(summary.open_pnl) : undefined}
            delay={180}
          />
          <KpiCard
            label="P&L Abierto %"
            value={summary?.open_pnl_pct ?? 0}
            type="percent"
            highlight
            subValue={`Realizado: ${formatUSD(summary?.realized_pnl ?? 0)}`}
            delay={240}
          />
        </div>

        {/* KPI Grid — Row 2: Concentration & Exposure */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="glass rounded-xl px-4 py-3 animate-slide-up" style={{ animationDelay: '300ms', animationFillMode: 'both' }}>
            <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">Mayor Posición</p>
            <p className="font-display font-700 text-white mt-0.5 text-lg">
              {topHolding ? (topHolding.ticker.split(':')[1] ?? topHolding.ticker) : '—'}
            </p>
            <p className="text-[11px] text-slate-500 font-mono">
              {topConcentration}% de la cartera
            </p>
          </div>
          <div className="glass rounded-xl px-4 py-3 animate-slide-up" style={{ animationDelay: '360ms', animationFillMode: 'both' }}>
            <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">Concentración Top 3</p>
            <p className="font-display font-700 text-white mt-0.5 text-lg">
              {top3Pct}%
            </p>
            <p className="text-[11px] text-slate-500 font-mono">
              {formatUSD(top3Value)} en top 3
            </p>
          </div>
          <div className="glass rounded-xl px-4 py-3 animate-slide-up" style={{ animationDelay: '420ms', animationFillMode: 'both' }}>
            <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">Beneficio / Riesgo</p>
            <p className={`font-display font-700 mt-0.5 text-lg ${(summary?.open_pnl ?? 0) + (summary?.realized_pnl ?? 0) >= 0 ? 'text-emerald' : 'text-rose'}`}>
              {formatUSD((summary?.open_pnl ?? 0) + (summary?.realized_pnl ?? 0))}
            </p>
            <p className="text-[11px] text-slate-500 font-mono">
              P&L abierto + realizado
            </p>
          </div>
          <div className="glass rounded-xl px-4 py-3 animate-slide-up" style={{ animationDelay: '480ms', animationFillMode: 'both' }}>
            <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">Diversificación</p>
            <p className="font-display font-700 text-white mt-0.5 text-lg">
              {positions.length} activos
            </p>
            <p className="text-[11px] text-slate-500 font-mono">
              {positions.filter(p => p.ticker.startsWith('BCBA:')).length} ARS · {positions.filter(p => !p.ticker.startsWith('BCBA:')).length} USD
            </p>
          </div>
        </div>

        {/* Best/Worst performers */}
        {summary?.best_performer && (
          <div className="hidden md:grid grid-cols-2 gap-3 mb-6">
            {[
              { label: '🏆 Mejor performer', pos: summary.best_performer },
              { label: '📉 Peor performer', pos: summary.worst_performer },
            ].filter(x => x.pos).map(({ label, pos }) => pos && (
              <div key={label} className="glass rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">{label}</p>
                  <p className="font-display font-700 text-white mt-0.5">
                    {pos.ticker.split(':')[1] ?? pos.ticker}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`font-mono font-600 text-sm ${(pos.pnl ?? 0) >= 0 ? 'text-emerald' : 'text-rose'}`}>
                    {pos.pnl_pct !== undefined ? `${pos.pnl_pct > 0 ? '+' : ''}${(pos.pnl_pct * 100).toFixed(2)}%` : '—'}
                  </p>
                  <p className="text-xs text-slate-600 font-mono">
                    {pos.pnl !== undefined ? `${pos.pnl >= 0 ? '+' : ''}${formatUSD(pos.pnl)}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Positions table */}
        <PositionsTable positions={positions} loading={positionsLoading} />

      </div>

      {showAddTx && <AddTransactionModal onClose={() => setShowAddTx(false)} onSuccess={fetchAllData} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} onSuccess={fetchAllData} />}
    </div>
  )
}
