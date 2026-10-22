'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { formatUSD } from '@/lib/utils'
import { SectionHead } from '@/components/resumen/ui'

const TICK = { fill: 'var(--ink-3)', fontSize: 11 }
const TOOLTIP = { backgroundColor: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, boxShadow: 'var(--shadow-pop)', fontSize: 13 }

export default function MonthlyTrend({ data }: { data: { month: string; label: string; total: number }[] }) {
  return (
    <section aria-labelledby="h-evolucion">
      <SectionHead id="h-evolucion" title="Evolución mensual" action={<span className="text-[13px] text-ink-3">Últimos 12 meses</span>} />
      {data.length === 0 ? (
        <p className="py-4 text-[13px] text-ink-3">Sin datos todavía.</p>
      ) : (
        <>
          <div className="h-[240px] pt-4 max-[819px]:h-[180px]" aria-hidden="true">
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
          </div>
          <ul className="sr-only">
            {data.map(d => <li key={d.month}>{d.label}: {formatUSD(d.total)}</li>)}
          </ul>
        </>
      )}
    </section>
  )
}
