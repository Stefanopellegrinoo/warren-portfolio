'use client'

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PricePoint } from '@/lib/on-catalog'
import { fmtDate, fmtNum } from '@/lib/on-format'

const TOOLTIP_STYLE = { backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }

export default function OnPriceChart({ history, ticker }: { history: PricePoint[]; ticker: string | null }) {
  if (history.length < 2) {
    return <p className="text-sm text-slate-400">Todavía no hay historial de precio para esta ON. Se acumula con el cierre de cada rueda.</p>
  }
  const first = history[0]
  const last = history[history.length - 1]
  const label = `Precio sucio de ${ticker ?? 'la ON'} entre ${fmtDate(first.date)} y ${fmtDate(last.date)}: de ${fmtNum(first.close)} a ${fmtNum(last.close)}`
  return (
    <div role="img" aria-label={label} className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#64748b', fontSize: 10 }} minTickGap={40} />
          <YAxis domain={['auto', 'auto']} tick={{ fill: '#64748b', fontSize: 10 }} width={48} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(d) => fmtDate(String(d))} formatter={(v) => [fmtNum(Number(v)), 'Precio sucio']} />
          <Line type="monotone" dataKey="close" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
