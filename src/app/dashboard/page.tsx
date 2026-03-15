'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Upload, Camera } from 'lucide-react'
import KpiCard from '@/components/ui/KpiCard'
import PositionsTable from '@/components/ui/PositionsTable'
import PortfolioChart from '@/components/charts/PortfolioChart'
import AddTransactionModal from '@/components/ui/AddTransactionModal'
import ImportModal from '@/components/ui/ImportModal'
import type { Position, PortfolioSummary, PortfolioSnapshot } from '@/types'
import { formatUSD } from '@/lib/utils'

export default function DashboardPage() {
  const [positions, setPositions] = useState<Position[]>([])
  const [summary, setSummary] = useState<PortfolioSummary | null>(null)
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([])
  const [period, setPeriod] = useState<'30' | '90' | '180' | '365'>('90')
  const [loading, setLoading] = useState(true)
  const [showAddTx, setShowAddTx] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [snapshotLoading, setSnapshotLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [posRes, snapRes] = await Promise.all([
        fetch('/api/positions'),
        fetch(`/api/portfolio-history?days=${period}`),
      ])
      const posData = await posRes.json()
      const snapData = await snapRes.json()
      setPositions(posData.positions ?? [])
      setSummary(posData.summary ?? null)
      setSnapshots(snapData.data ?? [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { fetchData() }, [fetchData])

  async function takeSnapshot() {
    setSnapshotLoading(true)
    try {
      await fetch('/api/portfolio-history', { method: 'POST' })
      fetchData()
    } finally {
      setSnapshotLoading(false)
    }
  }

  return (
    <div className="min-h-screen pl-56">
      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-8 animate-fade-in">
          <div>
            <h1 className="font-display font-800 text-3xl text-white tracking-tight">
              Portfolio
              <span className="text-amber text-glow-amber"> Overview</span>
            </h1>
            <p className="text-slate-500 font-mono text-sm mt-1">
              {new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={takeSnapshot} disabled={snapshotLoading}
              className="btn-ghost flex items-center gap-2 text-xs">
              <Camera className="w-3.5 h-3.5" />
              {snapshotLoading ? 'Guardando...' : 'Snapshot'}
            </button>
            <button onClick={() => setShowImport(true)}
              className="btn-ghost flex items-center gap-2 text-xs">
              <Upload className="w-3.5 h-3.5" />
              Importar Excel
            </button>
            <button onClick={() => setShowAddTx(true)}
              className="btn-primary flex items-center gap-2 text-xs">
              <Plus className="w-3.5 h-3.5" />
              Nueva Operación
            </button>
          </div>
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <KpiCard
            label="Valor de Mercado"
            value={summary?.total_market_value ?? 0}
            subValue={`${summary?.positions_count ?? 0} posiciones`}
            delay={0}
          />
          <KpiCard
            label="Capital Invertido"
            value={summary?.total_invested ?? 0}
            delay={60}
          />
          <KpiCard
            label="P&L Abierto"
            value={summary?.open_pnl ?? 0}
            highlight
            subValue={summary?.open_pnl_pct !== undefined ? formatUSD(summary.open_pnl) : undefined}
            delay={120}
          />
          <KpiCard
            label="P&L Abierto %"
            value={summary?.open_pnl_pct ?? 0}
            type="percent"
            highlight
            subValue={`Realizado: ${formatUSD(summary?.realized_pnl ?? 0)}`}
            delay={180}
          />
        </div>

        {/* Best/Worst performers */}
        {summary?.best_performer && (
          <div className="grid grid-cols-2 gap-3 mb-6">
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

        {/* Chart */}
        <div className="mb-6">
          <PortfolioChart data={snapshots} period={period} onPeriodChange={setPeriod} />
        </div>

        {/* Positions table */}
        <PositionsTable positions={positions} loading={loading} onRefresh={fetchData} />

      </div>

      {showAddTx && <AddTransactionModal onClose={() => setShowAddTx(false)} onSuccess={fetchData} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} onSuccess={fetchData} />}
    </div>
  )
}
