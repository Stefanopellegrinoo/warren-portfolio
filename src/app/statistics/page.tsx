'use client'

import { useState, useEffect } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import KpiCard from '@/components/ui/KpiCard'
import { formatUSD, formatPct } from '@/lib/utils'

interface StatData {
  maxDrawdown: number
  winRate: number
  totalPortfolioValue: number
  allocation: { name: string, value: number, pct: number }[]
  realizedPnl: number
  openPnl: number
  biggestWinner: { ticker: string, pnl: number, pnl_pct: number, status: string } | null
  biggestLoser: { ticker: string, pnl: number, pnl_pct: number, status: string } | null
  allPnLs: { ticker: string, pnl: number }[]
}

const COLORS = ['#F59E0B', '#10B981', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#EF4444', '#64748B']

export default function StatisticsPage() {
  const [data, setData] = useState<StatData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch('/api/statistics')
        const json = await res.json()
        setData(json)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
  }, [])

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-amber/30 border-t-amber rounded-full animate-spin" />
      </div>
    )
  }

  // Cap bar chart to top 5 and bottom 5 to keep it readable, or max 15 total
  const chartData = data.allPnLs.slice(0, 15)

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 md:pl-64 pb-24 md:pb-8">
      
      {/* Header */}
      <div className="mb-8 animate-fade-in">
        <h1 className="font-display font-800 text-2xl md:text-3xl text-white tracking-tight">
          Estadísticas
          <span className="text-amber text-glow-amber"> Avanzadas</span>
        </h1>
        <p className="text-slate-500 font-mono text-sm mt-1">
          Análisis profesional de riesgo y rendimiento histórico de tu cartera
        </p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard
          label="P&L Realizado Total"
          value={data.realizedPnl}
          highlight
          subValue={`Abierto: ${formatUSD(data.openPnl)}`}
          delay={0}
        />
        <KpiCard
          label="Win Rate"
          value={data.winRate}
          type="percent"
          subValue="Trades con ganancia"
          delay={60}
        />
        <KpiCard
          label="Mejor Trade Histórico"
          value={data.biggestWinner?.pnl ?? 0}
          highlight
          subValue={data.biggestWinner ? `${data.biggestWinner.ticker} (${formatPct(data.biggestWinner.pnl_pct)})` : 'N/A'}
          delay={120}
        />
        <KpiCard
          label="Peor Trade Histórico"
          value={data.biggestLoser?.pnl ?? 0}
          highlight
          subValue={data.biggestLoser ? `${data.biggestLoser.ticker} (${formatPct(data.biggestLoser.pnl_pct)})` : 'N/A'}
          delay={180}
        />
      </div>

      {/* Allocation & PnL Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* Allocation */}
        <div className="glass rounded-2xl p-4 md:p-6 relative min-h-[400px]">
          <h3 className="font-display font-700 text-white mb-6">Asset Allocation (Abierto)</h3>
          
          {data.allocation.length > 0 ? (
            <div className="relative h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.allocation}
                    cx="50%"
                    cy="50%"
                    innerRadius={80}
                    outerRadius={120}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="none"
                  >
                    {data.allocation.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => formatUSD(value)}
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                    itemStyle={{ color: '#fff', fontSize: '14px', fontFamily: 'monospace' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              
              {/* Center text */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Valor</span>
                <span className="font-display font-700 text-white text-xl mt-1">
                  {formatUSD(data.totalPortfolioValue)}
                </span>
              </div>
            </div>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-slate-500 font-mono text-sm">
              Sin datos suficientes
            </div>
          )}
        </div>

        {/* PnL Bar Chart */}
        <div className="glass rounded-2xl p-4 md:p-6">
          <h3 className="font-display font-700 text-white mb-6">P&L Histórico por Activo</h3>
          {chartData.length > 0 ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#132035" horizontal={true} vertical={false} />
                  <XAxis type="number" tickFormatter={v => formatUSD(v)} tick={{ fill: '#475569', fontSize: 10, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                  <YAxis dataKey="ticker" type="category" tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                  <Tooltip 
                    formatter={(value: number) => formatUSD(value)}
                    cursor={{fill: 'rgba(255,255,255,0.02)'}}
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                  />
                  <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#10b981' : '#f43f5e'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-slate-500 font-mono text-sm">
              Aún no hay trades registrados
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
