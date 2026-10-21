'use client'

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MonthRow } from '@/lib/on-portfolio-analytics'
import { fmtMonth, fmtNum, fmtUsdCompact } from '@/lib/on-format'

const TOOLTIP_STYLE = { backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }

/** Stacked bars (interest + principal) per month. The table next to it carries the same numbers for screen readers. */
export default function PortfolioCalendarChart({ months }: { months: MonthRow[] }) {
  const total = months.reduce((s, m) => s + m.total, 0)
  const label = `Calendario de cobros: ${months.length} meses, de ${fmtMonth(months[0]?.month)} a ${fmtMonth(months.at(-1)?.month)}, USD ${fmtNum(total)} en total. Los mismos datos están en la tabla.`
  const data = months.map((m) => ({ ...m, label: fmtMonth(m.month) }))
  return (
    <div role="img" aria-label={label} className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} minTickGap={24} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} width={64} tickFormatter={(v) => fmtUsdCompact(Number(v))} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(v, name) => [`USD ${fmtNum(Number(v))}`, String(name)]} />
          <Legend wrapperStyle={{ fontSize: 11, color: '#cbd5e1' }} />
          <Bar dataKey="interest" name="Intereses" stackId="m" fill="#f59e0b" isAnimationActive={false} />
          <Bar dataKey="principal" name="Capital" stackId="m" fill="#38bdf8" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
