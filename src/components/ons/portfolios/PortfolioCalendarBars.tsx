'use client'

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtNum, fmtUsdCompact } from '@/lib/on-format'

// Token colors, so the chart follows the light and dark themes. Interest in the accent, capital in warm grey.
const TOOLTIP_STYLE = { backgroundColor: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '6px', boxShadow: 'var(--shadow-pop)', color: 'var(--ink)', fontSize: 13 }
const TICK = { fill: 'var(--ink-3)', fontSize: 11 }

/** The recharts drawing of PortfolioCalendarChart, loaded on its own. */
export default function PortfolioCalendarBars({ data }: { data: { label: string; interest: number; principal: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--line)" vertical={false} />
        <XAxis dataKey="label" tick={TICK} stroke="var(--line)" tickLine={false} minTickGap={24} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} width={64} tickFormatter={(v) => fmtUsdCompact(Number(v))} />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--ink-3)' }} itemStyle={{ color: 'var(--ink)' }} cursor={{ fill: 'var(--hover)' }} formatter={(v, name) => [`USD ${fmtNum(Number(v))}`, String(name)]} />
        <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 13, color: 'var(--ink-2)' }} />
        <Bar dataKey="interest" name="Intereses" stackId="m" fill="var(--accent)" isAnimationActive={false} />
        <Bar dataKey="principal" name="Capital" stackId="m" fill="var(--line-strong)" isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}
