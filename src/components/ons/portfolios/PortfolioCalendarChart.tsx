'use client'

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MonthRow } from '@/lib/on-portfolio-analytics'
import { fmtMonth, fmtNum, fmtUsdCompact } from '@/lib/on-format'

// Token colors, so the chart follows the light and dark themes. Interest in the accent, capital in warm grey.
const TOOLTIP_STYLE = { backgroundColor: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '6px', boxShadow: 'var(--shadow-pop)', color: 'var(--ink)', fontSize: 13 }
const TICK = { fill: 'var(--ink-3)', fontSize: 11 }

/** Stacked bars (interest + principal) per month. The table next to it carries the same numbers for screen readers. */
export default function PortfolioCalendarChart({ months }: { months: MonthRow[] }) {
  const total = months.reduce((s, m) => s + m.total, 0)
  const label = `Calendario de cobros: ${months.length} meses, de ${fmtMonth(months[0]?.month)} a ${fmtMonth(months.at(-1)?.month)}, USD ${fmtNum(total)} en total. Los mismos datos están en la tabla.`
  const data = months.map((m) => ({ ...m, label: fmtMonth(m.month) }))
  return (
    <div role="img" aria-label={label} className="h-64 w-full max-[819px]:h-56">
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
    </div>
  )
}
