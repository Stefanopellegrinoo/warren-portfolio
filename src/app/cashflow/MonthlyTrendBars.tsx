'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { formatUSD } from '@/lib/utils'

const TICK = { fill: 'var(--ink-3)', fontSize: 11 }
const TOOLTIP = { backgroundColor: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, boxShadow: 'var(--shadow-pop)', fontSize: 13 }

/** The recharts bars of MonthlyTrend, loaded with the chart (odd/tasks/rendimiento.md S9). */
export default function MonthlyTrendBars({ data }: { data: { month: string; label: string; total: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--line)" vertical={false} />
        <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} width={76} tickFormatter={(v: number) => formatUSD(v, true)} />
        <Tooltip
          formatter={(value: number) => [formatUSD(value), 'Total']}
          cursor={{ fill: 'var(--hover)' }}
          contentStyle={TOOLTIP}
          labelStyle={{ color: 'var(--ink)', fontWeight: 500 }}
          itemStyle={{ color: 'var(--ink-2)' }}
        />
        <Bar dataKey="total" fill="var(--accent)" radius={[2, 2, 0, 0]} maxBarSize={32} />
      </BarChart>
    </ResponsiveContainer>
  )
}
