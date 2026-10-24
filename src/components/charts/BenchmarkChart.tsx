'use client'

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import type { BenchmarkComparison as Comparison } from '@/lib/benchmark'
import { formatNumber } from '@/lib/utils'
import { AXIS, GRID, TOOLTIP } from './tokens'

const pct = (v: number) => `${formatNumber(v, { decimals: 1, sign: true })} %`
const utcDate = (v: string) => new Date(v).toLocaleDateString('es-AR', { timeZone: 'UTC' })

/** The recharts drawing of BenchmarkComparison, loaded on its own. */
export default function BenchmarkChart({ result }: { result: Comparison }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={result.points} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} accessibilityLayer>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="date" {...AXIS} minTickGap={24}
          tickFormatter={(v: string) => { const d = new Date(v); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}` }} />
        <YAxis {...AXIS} width={44} tickFormatter={(v: number) => `${formatNumber(v, { decimals: 0 })} %`} />
        <Tooltip {...TOOLTIP} formatter={(v: number) => pct(v)} labelFormatter={utcDate} />
        <Line type="monotone" dataKey="portfolioPct" name="Cartera" stroke="var(--accent)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="benchmarkPct" name={result.label} stroke="var(--ink-3)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
