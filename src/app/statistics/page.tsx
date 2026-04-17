'use client'

import { useState, useEffect } from 'react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line, AreaChart, Area,
} from 'recharts'
import KpiCard from '@/components/ui/KpiCard'
import { formatUSD, formatPct, cn } from '@/lib/utils'

interface StatData {
  maxDrawdown: number
  winRate: number
  totalPortfolioValue: number
  allocation: { name: string; value: number; pct: number }[]
  realizedPnl: number
  openPnl: number
  biggestWinner: { ticker: string; pnl: number; pnl_pct: number; status: string } | null
  biggestLoser: { ticker: string; pnl: number; pnl_pct: number; status: string } | null
  allPnLs: { ticker: string; pnl: number }[]
  monthlyReturns: { month: string; pnl: number; trades: number }[]
  cumulativePnl: { date: string; ticker: string; pnl: number; cumulative: number }[]
  avgHoldingDays: number
  maxHoldingDays: number
  minHoldingDays: number
  avgWin: number
  avgLoss: number
  profitFactor: number
  sharpeRatio: number
  annualizedVol: number
  monthlyStdDev: number
  winnersCount: number
  losersCount: number
  totalTrades: number
  arsExposure: number
  usdExposure: number
}

interface CombinedData {
  totalValue: number
  composition: { name: string; value: number; pct: number }[]
  stocks: {
    value: number
    openPnl: number
    realizedPnl: number
    totalPnl: number
    positionCount: number
    closedTradesCount: number
  }
  ons: {
    value: number
    openPnl: number
    realizedPnl: number
    totalPnl: number
    positionCount: number
    closedTradesCount: number
  }
}

const COLORS = ['#F59E0B', '#10B981', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#EF4444', '#64748B', '#06B6D4', '#84CC16']
const TOOLTIP_STYLE = { backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }

type TabType = 'general' | 'stocks' | 'ons'

// Component to render detailed statistics
function DetailedStats({ data, assetLabel }: { data: StatData; assetLabel: string }) {
  const chartData = data.allPnLs.slice(0, 15)
  const totalPnl = data.realizedPnl + data.openPnl

  return (
    <>
      {/* ═══════════════ ROW 1: Core KPIs ═══════════════ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <KpiCard
          label="P&L Total (Abierto + Realizado)"
          value={totalPnl}
          highlight
          subValue={`Abierto: ${formatUSD(data.openPnl)} · Realizado: ${formatUSD(data.realizedPnl)}`}
          delay={0}
        />
        <KpiCard
          label="Win Rate"
          value={data.winRate}
          type="percent"
          subValue={`${data.winnersCount}W / ${data.losersCount}L de ${data.totalTrades} trades`}
          delay={60}
        />
        <KpiCard
          label="Mejor Trade"
          value={data.biggestWinner?.pnl ?? 0}
          highlight
          subValue={data.biggestWinner ? `${data.biggestWinner.ticker} (${formatPct(data.biggestWinner.pnl_pct)}) · ${data.biggestWinner.status}` : 'N/A'}
          delay={120}
        />
        <KpiCard
          label="Peor Trade"
          value={data.biggestLoser?.pnl ?? 0}
          highlight
          subValue={data.biggestLoser ? `${data.biggestLoser.ticker} (${formatPct(data.biggestLoser.pnl_pct)}) · ${data.biggestLoser.status}` : 'N/A'}
          delay={180}
        />
      </div>

      {/* ═══════════════ ROW 2: Risk Metrics ═══════════════ */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <div className="glass rounded-xl px-4 py-3 animate-slide-up" style={{ animationDelay: '240ms', animationFillMode: 'both' }}>
          <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">Sharpe Ratio</p>
          <p className={`font-display font-700 text-xl mt-0.5 ${data.sharpeRatio >= 1 ? 'text-emerald' : data.sharpeRatio >= 0 ? 'text-amber' : 'text-rose'}`}>
            {data.sharpeRatio.toFixed(2)}
          </p>
          <p className="text-[10px] text-slate-500 font-mono">
            {data.sharpeRatio >= 2 ? 'Excelente' : data.sharpeRatio >= 1 ? 'Bueno' : data.sharpeRatio >= 0 ? 'Aceptable' : 'Negativo'}
          </p>
        </div>
        <div className="glass rounded-xl px-4 py-3 animate-slide-up" style={{ animationDelay: '300ms', animationFillMode: 'both' }}>
          <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">Volatilidad Anual</p>
          <p className="font-display font-700 text-xl mt-0.5 text-white">
            {formatUSD(data.annualizedVol)}
          </p>
          <p className="text-[10px] text-slate-500 font-mono">Mensual: {formatUSD(data.monthlyStdDev)}</p>
        </div>
        <div className="glass rounded-xl px-4 py-3 animate-slide-up" style={{ animationDelay: '360ms', animationFillMode: 'both' }}>
          <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">Profit Factor</p>
          <p className={`font-display font-700 text-xl mt-0.5 ${data.profitFactor >= 1.5 ? 'text-emerald' : data.profitFactor >= 1 ? 'text-amber' : 'text-rose'}`}>
            {data.profitFactor.toFixed(2)}x
          </p>
          <p className="text-[10px] text-slate-500 font-mono">
            Prom. Win: {formatUSD(data.avgWin)}
          </p>
        </div>
        <div className="glass rounded-xl px-4 py-3 animate-slide-up" style={{ animationDelay: '420ms', animationFillMode: 'both' }}>
          <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">Max Drawdown</p>
          <p className={`font-display font-700 text-xl mt-0.5 ${data.maxDrawdown < -0.1 ? 'text-rose' : 'text-slate-300'}`}>
            {(data.maxDrawdown * 100).toFixed(1)}%
          </p>
          <p className="text-[10px] text-slate-500 font-mono">Caída máxima desde pico</p>
        </div>
        <div className="glass rounded-xl px-4 py-3 animate-slide-up" style={{ animationDelay: '480ms', animationFillMode: 'both' }}>
          <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">Holding Promedio</p>
          <p className="font-display font-700 text-xl mt-0.5 text-white">
            {data.avgHoldingDays}d
          </p>
          <p className="text-[10px] text-slate-500 font-mono">
            Min: {data.minHoldingDays}d · Max: {data.maxHoldingDays}d
          </p>
        </div>
      </div>

      {/* ═══════════════ ROW 3: Cumulative P&L Chart ═══════════════ */}
      {data.cumulativePnl.length > 0 && (
        <div className="glass rounded-2xl p-4 md:p-6 mb-6 animate-fade-in">
          <h3 className="font-display font-700 text-white mb-1">Curva de Rentabilidad Acumulada</h3>
          <p className="text-[11px] text-slate-500 font-mono mb-4">Evolución del P&L realizado a lo largo del tiempo</p>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.cumulativePnl}>
                <defs>
                  <linearGradient id="gradPnl" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#132035" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#475569', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                  axisLine={false} tickLine={false}
                  tickFormatter={(v: string) => {
                    const d = new Date(v)
                    return `${d.getDate()}/${d.getMonth() + 1}`
                  }}
                />
                <YAxis
                  tick={{ fill: '#475569', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                  axisLine={false} tickLine={false}
                  tickFormatter={(v: number) => formatUSD(v, true)}
                />
                <Tooltip
                  formatter={(value: number) => [formatUSD(value), 'P&L Acumulado']}
                  labelFormatter={(label: string) => {
                    const d = new Date(label)
                    return d.toLocaleDateString('es-AR')
                  }}
                  contentStyle={TOOLTIP_STYLE}
                  itemStyle={{ color: '#10b981', fontSize: '13px', fontFamily: 'monospace' }}
                />
                <Area type="monotone" dataKey="cumulative" stroke="#10b981" strokeWidth={2} fill="url(#gradPnl)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ═══════════════ ROW 4: Monthly Returns + Allocation ═══════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Monthly Returns */}
        <div className="glass rounded-2xl p-4 md:p-6">
          <h3 className="font-display font-700 text-white mb-1">Rentabilidad Mensual</h3>
          <p className="text-[11px] text-slate-500 font-mono mb-4">P&L realizado por mes calendario</p>
          {data.monthlyReturns.length > 0 ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthlyReturns}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#132035" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: '#475569', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                    axisLine={false} tickLine={false}
                    tickFormatter={(v: string) => {
                      const [y, m] = v.split('-')
                      return `${m}/${y.slice(2)}`
                    }}
                  />
                  <YAxis
                    tick={{ fill: '#475569', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                    axisLine={false} tickLine={false}
                    tickFormatter={(v: number) => formatUSD(v, true)}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [formatUSD(value), 'P&L Mes']}
                    labelFormatter={(label: string) => {
                      const [y, m] = label.split('-')
                      const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
                      return `${months[parseInt(m)-1]} ${y}`
                    }}
                    contentStyle={TOOLTIP_STYLE}
                  />
                  <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                    {data.monthlyReturns.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#10b981' : '#f43f5e'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-slate-500 font-mono text-sm">
              Sin trades cerrados aún
            </div>
          )}
        </div>

        {/* Allocation */}
        <div className="glass rounded-2xl p-4 md:p-6 relative">
          <h3 className="font-display font-700 text-white mb-1">Distribución de Cartera ({assetLabel})</h3>
          <p className="text-[11px] text-slate-500 font-mono mb-4">Peso por activo (posiciones abiertas)</p>
          
          {data.allocation.length > 0 ? (
            <div className="flex flex-col gap-4">
              <div className="relative h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.allocation}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
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
                      contentStyle={TOOLTIP_STYLE}
                      itemStyle={{ color: '#fff', fontSize: '13px', fontFamily: 'monospace' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Total</span>
                  <span className="font-display font-700 text-white text-lg mt-0.5">
                    {formatUSD(data.totalPortfolioValue)}
                  </span>
                </div>
              </div>

              {/* Legend */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {data.allocation.map((item, i) => (
                  <div key={item.name} className="flex items-center gap-2 text-[11px] font-mono">
                    <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-slate-400 truncate">{item.name}</span>
                    <span className="text-slate-600 ml-auto">{(item.pct * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-slate-500 font-mono text-sm">
              Sin datos suficientes
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════ ROW 5: P&L by Asset + Exposure ═══════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* PnL Bar Chart */}
        <div className="glass rounded-2xl p-4 md:p-6">
          <h3 className="font-display font-700 text-white mb-1">P&L Histórico por Activo</h3>
          <p className="text-[11px] text-slate-500 font-mono mb-4">Ganancia/pérdida por ticker (abiertos + cerrados)</p>
          {chartData.length > 0 ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#132035" horizontal={true} vertical={false} />
                  <XAxis
                    type="number"
                    tickFormatter={v => formatUSD(v, true)}
                    tick={{ fill: '#475569', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                    axisLine={false} tickLine={false}
                  />
                  <YAxis
                    dataKey="ticker" type="category"
                    tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'var(--font-mono)' }}
                    axisLine={false} tickLine={false}
                    width={50}
                  />
                  <Tooltip
                    formatter={(value: number) => formatUSD(value)}
                    cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                    contentStyle={TOOLTIP_STYLE}
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

        {/* Currency Exposure + Trading Stats */}
        <div className="flex flex-col gap-6">
          {/* Currency Exposure */}
          <div className="glass rounded-2xl p-4 md:p-6">
            <h3 className="font-display font-700 text-white mb-4">Exposición por Moneda</h3>
            <div className="space-y-3">
              {[
                { label: 'USD (Mercados Internacionales)', value: data.usdExposure, color: '#10b981' },
                { label: 'ARS (Mercado Local vía CCL)', value: data.arsExposure, color: '#F59E0B' },
              ].map(({ label, value, color }) => {
                const pct = data.totalPortfolioValue > 0 ? (value / data.totalPortfolioValue) * 100 : 0
                return (
                  <div key={label}>
                    <div className="flex justify-between text-[11px] font-mono mb-1">
                      <span className="text-slate-400">{label}</span>
                      <span className="text-white font-600">{formatUSD(value)} ({pct.toFixed(1)}%)</span>
                    </div>
                    <div className="w-full h-2 bg-bg-600 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Trading Performance Summary */}
          <div className="glass rounded-2xl p-4 md:p-6">
            <h3 className="font-display font-700 text-white mb-4">Resumen de Trading</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Trades Totales', val: data.totalTrades.toString() },
                { label: 'Win Rate', val: `${(data.winRate * 100).toFixed(0)}%` },
                { label: 'Ganancia Prom.', val: formatUSD(data.avgWin), cls: 'text-emerald' },
                { label: 'Pérdida Prom.', val: formatUSD(data.avgLoss), cls: 'text-rose' },
                { label: 'Profit Factor', val: `${data.profitFactor.toFixed(2)}x` },
                { label: 'Holding Prom.', val: `${data.avgHoldingDays} días` },
              ].map(({ label, val, cls }) => (
                <div key={label} className="flex flex-col">
                  <span className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">{label}</span>
                  <span className={`font-mono font-600 text-sm mt-0.5 ${cls ?? 'text-white'}`}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default function StatisticsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('general')
  const [stocksData, setStocksData] = useState<StatData | null>(null)
  const [onsData, setOnsData] = useState<StatData | null>(null)
  const [combinedData, setCombinedData] = useState<CombinedData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchAllStats() {
      try {
        const [stocksRes, onsRes, combinedRes] = await Promise.all([
          fetch('/api/statistics'),
          fetch('/api/statistics/ons'),
          fetch('/api/statistics/combined')
        ])
        
        const [stocks, ons, combined] = await Promise.all([
          stocksRes.json(),
          onsRes.json(),
          combinedRes.json()
        ])
        
        setStocksData(stocks)
        setOnsData(ons)
        setCombinedData(combined)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchAllStats()
  }, [])

  if (loading || !combinedData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-amber/30 border-t-amber rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 md:pl-64 pb-24 md:pb-8">

      {/* Header */}
      <div className="mb-6 animate-fade-in">
        <h1 className="font-display font-800 text-2xl md:text-3xl text-white tracking-tight">
          Estadísticas
          <span className="text-amber text-glow-amber"> Avanzadas</span>
        </h1>
        <p className="text-slate-500 font-mono text-sm mt-1">
          Análisis profesional de riesgo, rendimiento y rentabilidad de tu cartera
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('general')}
          className={`px-4 py-2 rounded-lg font-mono text-sm transition ${
            activeTab === 'general' 
              ? 'bg-amber text-slate-900 font-600' 
              : 'glass text-slate-400 hover:text-white'
          }`}
        >
          General
        </button>
        
        {combinedData.stocks.positionCount > 0 && (
          <button
            onClick={() => setActiveTab('stocks')}
            className={`px-4 py-2 rounded-lg font-mono text-sm transition ${
              activeTab === 'stocks' 
                ? 'bg-emerald text-slate-900 font-600' 
                : 'glass text-slate-400 hover:text-white'
            }`}
          >
            Acciones
          </button>
        )}
        
        {combinedData.ons.positionCount > 0 && (
          <button
            onClick={() => setActiveTab('ons')}
            className={`px-4 py-2 rounded-lg font-mono text-sm transition ${
              activeTab === 'ons' 
                ? 'bg-blue-500 text-slate-900 font-600' 
                : 'glass text-slate-400 hover:text-white'
            }`}
          >
            ONs
          </button>
        )}
      </div>

      {/* General Tab */}
      {activeTab === 'general' && (
        <div>
          {/* High-level KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            <KpiCard
              label="Valor Total Cartera"
              value={combinedData.totalValue}
              highlight
              delay={0}
            />
            <KpiCard
              label="P&L Acciones"
              value={combinedData.stocks.totalPnl}
              highlight
              subValue={`${combinedData.stocks.positionCount} posiciones · ${combinedData.stocks.closedTradesCount} trades`}
              delay={60}
            />
            <KpiCard
              label="P&L ONs"
              value={combinedData.ons.totalPnl}
              highlight
              subValue={`${combinedData.ons.positionCount} posiciones · ${combinedData.ons.closedTradesCount} trades`}
              delay={120}
            />
          </div>

          {/* Composition Pie Chart */}
          <div className="glass rounded-2xl p-4 md:p-6 relative mb-6">
            <h3 className="font-display font-700 text-white mb-1">Composición de Cartera</h3>
            <p className="text-[11px] text-slate-500 font-mono mb-4">Distribución por clase de activo</p>
            
            {combinedData.composition.length > 0 ? (
              <div className="flex flex-col gap-4">
                <div className="relative h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={combinedData.composition}
                        cx="50%"
                        cy="50%"
                        innerRadius={70}
                        outerRadius={110}
                        paddingAngle={3}
                        dataKey="value"
                        stroke="none"
                      >
                        {combinedData.composition.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number) => formatUSD(value)}
                        contentStyle={TOOLTIP_STYLE}
                        itemStyle={{ color: '#fff', fontSize: '13px', fontFamily: 'monospace' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Total</span>
                    <span className="font-display font-700 text-white text-2xl mt-0.5">
                      {formatUSD(combinedData.totalValue)}
                    </span>
                  </div>
                </div>

                {/* Legend */}
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
                  {combinedData.composition.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-2 text-[12px] font-mono">
                      <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-slate-300 truncate">{item.name}</span>
                      <span className="text-slate-500 ml-auto font-600">{(item.pct * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-slate-500 font-mono text-sm">
                Sin datos suficientes
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stocks Tab */}
      {activeTab === 'stocks' && stocksData && (
        <DetailedStats data={stocksData} assetLabel="Acciones" />
      )}

      {/* ONs Tab */}
      {activeTab === 'ons' && onsData && (
        <DetailedStats data={onsData} assetLabel="ONs" />
      )}

    </div>
  )
}
