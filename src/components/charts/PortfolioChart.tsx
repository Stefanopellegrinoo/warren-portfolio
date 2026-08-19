'use client'

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceArea } from 'recharts'
import { formatUSD, formatDate } from '@/lib/utils'
import { estimatedRanges } from '@/lib/series-provenance'

/**
 * What the chart actually consumes. Declared here rather than reusing
 * PortfolioSnapshot: a component should state its own contract instead of
 * dragging the shape of a database table through the app, and the history
 * endpoint sends fewer fields than that table has.
 */
export interface PortfolioChartPoint {
  snapshot_date: string
  value: number
  invested: number
  source?: 'live' | 'estimated'
}

interface Props {
  data: PortfolioChartPoint[]
  period: '30' | '90' | '180' | '365' | 'all'
  onPeriodChange: (p: '30' | '90' | '180' | '365' | 'all') => void
}

const PERIODS = [
  { label: '1M', value: '30' },
  { label: '3M', value: '90' },
  { label: '6M', value: '180' },
  { label: '1A', value: '365' },
  { label: 'MÁX', value: 'all' },
] as const

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; payload?: { isEstimated?: boolean } }>; label?: string }) {
  if (!active || !payload?.length) return null
  const isEstimated = payload[0]?.payload?.isEstimated === true
  return (
    <div className="glass rounded-xl p-3 border border-white/10 text-xs font-mono">
      <p className="text-slate-400 mb-2">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className={p.name === 'value' ? 'text-amber' : 'text-slate-400'}>
          {p.name === 'value' ? 'Valor' : 'Invertido'}: {formatUSD(p.value)}
        </p>
      ))}
      {payload[0] && payload[1] && (() => {
        // Recharts orders payload by series declaration order, not by semantic meaning.
        // Positional indexing broke because Area elements appear as [invested, value],
        // but the code assumed the opposite. Look each series up by name instead — this survives
        // if the Area elements are ever reordered.
        const value = payload.find(p => p.name === 'value')?.value
        const invested = payload.find(p => p.name === 'invested')?.value
        if (typeof value === 'number' && typeof invested === 'number') {
          return (
            <p className={value >= invested ? 'text-emerald mt-1' : 'text-rose mt-1'}>
              P&L: {formatUSD(value - invested)}
            </p>
          )
        }
        return null
      })()}
      {isEstimated && (
        <p className="text-amber/70 mt-1">Valor reconstruido</p>
      )}
    </div>
  )
}

export default function PortfolioChart({ data, period, onPeriodChange }: Props) {
  const chartData = data.map(s => ({
    date: formatDate(s.snapshot_date),
    value: s.value,
    invested: s.invested,
    isEstimated: s.source === 'estimated',
  }))

  // ReferenceArea x-bounds must be values the XAxis actually holds, and the
  // axis holds formatted dates — so map the ISO ranges through the same
  // formatter rather than passing raw YYYY-MM-DD, which would match nothing
  // and render no band at all.
  const shadedRanges = estimatedRanges(data).map(r => ({
    from: formatDate(r.from),
    to: formatDate(r.to),
  }))

  const isPositive = data.length >= 2
    ? data[data.length - 1].value >= data[0].value
    : true

  return (
    <div className="glass rounded-2xl p-4 md:p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-display font-700 text-white">Evolución del Portfolio</h3>
          <p className="text-[11px] text-slate-500 font-mono mt-0.5">Valor de mercado vs capital invertido</p>
          {shadedRanges.length > 0 && (
            <p className="text-[10px] text-amber/70 font-mono mt-0.5">
              Tramo sombreado: valores reconstruidos, no medidos
            </p>
          )}
        </div>
        <div className="flex gap-1">
          {PERIODS.map(({ label, value }) => (
            <button key={value} onClick={() => onPeriodChange(value)}
              className={`px-2 md:px-3 py-1 rounded-lg text-xs font-mono transition-all duration-150
                ${period === value ? 'bg-amber/20 text-amber border border-amber/30' : 'text-slate-500 hover:text-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {data.length < 2 ? (
        <div className="h-48 flex items-center justify-center">
          <div className="text-center">
            <p className="text-slate-500 text-sm font-mono">Sin datos suficientes</p>
            <p className="text-slate-600 text-xs font-mono mt-1">
              Los snapshots diarios se generan automáticamente
            </p>
          </div>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            {shadedRanges.map((r, i) => (
              <ReferenceArea
                key={`est-${i}`}
                x1={r.from}
                x2={r.to}
                fill="#f59e0b"
                fillOpacity={0.07}
                strokeOpacity={0}
                ifOverflow="extendDomain"
              />
            ))}
            <defs>
              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={isPositive ? '#10b981' : '#f43f5e'} stopOpacity={0.2} />
                <stop offset="95%" stopColor={isPositive ? '#10b981' : '#f43f5e'} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorInvested" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.1} />
                <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#132035" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 10, fontFamily: 'var(--font-mono)' }}
              axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#475569', fontSize: 10, fontFamily: 'var(--font-mono)' }}
              axisLine={false} tickLine={false}
              tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="invested" stroke="#475569" strokeWidth={1}
              fill="url(#colorInvested)" dot={false} name="invested" />
            <Area type="monotone" dataKey="value"
              stroke={isPositive ? '#10b981' : '#f43f5e'} strokeWidth={2}
              fill="url(#colorValue)" dot={false} name="value" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
