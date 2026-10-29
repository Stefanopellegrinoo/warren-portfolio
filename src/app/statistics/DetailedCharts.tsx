'use client'

import { ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, LineChart, Line } from 'recharts'
import { AXIS, GRID, TOOLTIP, GAIN, LOSS, signed, axisSigned } from '@/components/charts/tokens'
import type { StatData } from './DetailedStats'

// The recharts drawings of DetailedStats, loaded on their own (odd/tasks/rendimiento.md S9).
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
/** 'YYYY-MM' → 'Mar 2026': a month always with its year. */
const monthLabel = (v: string) => { const [y, m] = v.split('-'); return `${MONTHS[parseInt(m) - 1]} ${y}` }

export function CumulativeChart({ data }: { data: StatData['cumulativePnl'] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} accessibilityLayer>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="date" {...AXIS} minTickGap={24}
          tickFormatter={(v: string) => { const d = new Date(v); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${String(d.getUTCFullYear()).slice(2)}` }} />
        <YAxis {...AXIS} width={52} tickFormatter={axisSigned} />
        <Tooltip {...TOOLTIP}
          formatter={(value: number) => [signed(value), 'Acumulado']}
          labelFormatter={(label: string) => new Date(label).toLocaleDateString('es-AR', { timeZone: 'UTC' })} />
        <Line type="monotone" dataKey="cumulative" stroke="var(--accent)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function MonthlyChart({ data }: { data: StatData['monthlyReturns'] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} accessibilityLayer>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="month" {...AXIS} minTickGap={12} tickFormatter={monthLabel} />
        <YAxis {...AXIS} width={52} tickFormatter={axisSigned} />
        <Tooltip {...TOOLTIP}
          formatter={(value: number) => [signed(value), 'Resultado']}
          labelFormatter={monthLabel} />
        <Bar dataKey="pnl" radius={[2, 2, 0, 0]} maxBarSize={28} isAnimationActive={false}>
          {data.map((entry, i) => <Cell key={i} fill={entry.pnl >= 0 ? GAIN : LOSS} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function AssetChart({ data }: { data: StatData['allPnLs'] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
        <CartesianGrid stroke="var(--line)" horizontal={false} />
        <XAxis type="number" {...AXIS} tickFormatter={axisSigned} />
        <YAxis dataKey="ticker" type="category" {...AXIS} tick={{ fill: 'var(--ink-2)', fontSize: 12 }} width={56} />
        <Tooltip {...TOOLTIP} formatter={(value: number) => [signed(value), 'Resultado']} />
        <Bar dataKey="pnl" radius={[0, 2, 2, 0]} barSize={14} isAnimationActive={false}>
          {data.map((entry, i) => <Cell key={i} fill={entry.pnl >= 0 ? GAIN : LOSS} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
