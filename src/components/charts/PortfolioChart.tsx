'use client'

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { formatUSD, formatDate } from '@/lib/utils'
import type { PortfolioSnapshot } from '@/types'

interface Props {
  data: PortfolioSnapshot[]
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

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass rounded-xl p-3 border border-white/10 text-xs font-mono">
      <p className="text-slate-400 mb-2">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className={p.name === 'total_value' ? 'text-amber' : 'text-slate-400'}>
          {p.name === 'total_value' ? 'Valor' : 'Invertido'}: {formatUSD(p.value)}
        </p>
      ))}
      {payload[0] && payload[1] && (
        <p className={payload[0].value >= payload[1].value ? 'text-emerald mt-1' : 'text-rose mt-1'}>
          P&L: {formatUSD(payload[0].value - payload[1].value)}
        </p>
      )}
    </div>
  )
}

export default function PortfolioChart({ data, period, onPeriodChange }: Props) {
  const chartData = data.map(s => ({
    date: formatDate(s.snapshot_date),
    total_value: s.total_value,
    total_invested: s.total_invested,
  }))

  const isPositive = data.length >= 2
    ? data[data.length - 1].total_value >= data[0].total_value
    : true

  return (
    <div className="glass rounded-2xl p-4 md:p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-display font-700 text-white">Evolución del Portfolio</h3>
          <p className="text-[11px] text-slate-500 font-mono mt-0.5">Valor de mercado vs capital invertido</p>
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
              Tomá snapshots diarios desde el botón &quot;Snapshot&quot;
            </p>
          </div>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
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
            <Area type="monotone" dataKey="total_invested" stroke="#475569" strokeWidth={1}
              fill="url(#colorInvested)" dot={false} name="total_invested" />
            <Area type="monotone" dataKey="total_value"
              stroke={isPositive ? '#10b981' : '#f43f5e'} strokeWidth={2}
              fill="url(#colorValue)" dot={false} name="total_value" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
