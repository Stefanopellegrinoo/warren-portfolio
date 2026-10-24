'use client'

import dynamic from 'next/dynamic'
import { formatUSD } from '@/lib/utils'
import { SectionHead } from '@/components/resumen/ui'
import ChartPlaceholder from '@/components/charts/ChartPlaceholder'

// Recharts arrives with the bars, not with Caja's first load; the placeholder holds the box.
const Bars = dynamic(() => import('./MonthlyTrendBars'), { ssr: false, loading: () => <ChartPlaceholder /> })

export default function MonthlyTrend({ data }: { data: { month: string; label: string; total: number }[] }) {
  return (
    <section aria-labelledby="h-evolucion">
      <SectionHead id="h-evolucion" title="Evolución mensual" action={<span className="text-[13px] text-ink-3">Últimos 12 meses</span>} />
      {data.length === 0 ? (
        <p className="py-4 text-[13px] text-ink-3">Sin datos todavía.</p>
      ) : (
        <>
          <div className="h-[240px] pt-4 max-[819px]:h-[180px]" aria-hidden="true">
            <Bars data={data} />
          </div>
          <ul className="sr-only">
            {data.map(d => <li key={d.month}>{d.label}: {formatUSD(d.total)}</li>)}
          </ul>
        </>
      )}
    </section>
  )
}
