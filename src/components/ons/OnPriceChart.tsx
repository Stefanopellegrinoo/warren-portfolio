'use client'

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PricePoint } from '@/lib/on-catalog'
import { fmtDate, fmtNum } from '@/lib/on-format'

// Token colors, so the chart follows the light and dark themes.
const TOOLTIP_STYLE = { backgroundColor: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '6px', boxShadow: 'var(--shadow-pop)', color: 'var(--ink)', fontSize: 13 }
const TICK = { fill: 'var(--ink-3)', fontSize: 11 }

export default function OnPriceChart({ history, ticker }: { history: PricePoint[]; ticker: string | null }) {
  if (history.length < 2) {
    return <p className="text-ink-3">Todavía no hay historial de precio para esta ON. Se acumula con el cierre de cada rueda.</p>
  }
  const first = history[0]
  const last = history[history.length - 1]
  const label = `Precio sucio de ${ticker ?? 'la ON'} entre ${fmtDate(first.date)} y ${fmtDate(last.date)}: de ${fmtNum(first.close)} a ${fmtNum(last.close)}`
  return (
    <div role="img" aria-label={label} className="h-56 w-full max-[819px]:h-[180px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDate} tick={TICK} stroke="var(--line)" tickLine={false} minTickGap={40} />
          <YAxis domain={['auto', 'auto']} tick={TICK} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => fmtNum(Number(v))} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--ink-3)' }} itemStyle={{ color: 'var(--ink)' }} cursor={{ stroke: 'var(--line-strong)' }} labelFormatter={(d) => fmtDate(String(d))} formatter={(v) => [fmtNum(Number(v)), 'Precio sucio']} />
          <Line type="monotone" dataKey="close" stroke="var(--accent)" strokeWidth={1.75} dot={false} activeDot={{ r: 3.5, fill: 'var(--accent)', stroke: 'var(--bg)', strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
