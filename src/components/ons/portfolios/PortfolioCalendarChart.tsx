'use client'

import dynamic from 'next/dynamic'
import ChartPlaceholder from '@/components/charts/ChartPlaceholder'
import type { MonthRow } from '@/lib/on-portfolio-analytics'
import { fmtMonth, fmtNum } from '@/lib/on-format'

// recharts arrives with the chart, not with the page (odd/tasks/rendimiento.md S9).
const PortfolioCalendarBars = dynamic(() => import('./PortfolioCalendarBars'), { ssr: false, loading: ChartPlaceholder })

/** Stacked bars (interest + principal) per month. The table next to it carries the same numbers for screen readers. */
export default function PortfolioCalendarChart({ months }: { months: MonthRow[] }) {
  const total = months.reduce((s, m) => s + m.total, 0)
  const label = `Calendario de cobros: ${months.length} meses, de ${fmtMonth(months[0]?.month)} a ${fmtMonth(months.at(-1)?.month)}, USD ${fmtNum(total)} en total. Los mismos datos están en la tabla.`
  const data = months.map((m) => ({ ...m, label: fmtMonth(m.month) }))
  return (
    <div role="img" aria-label={label} className="h-64 w-full max-[819px]:h-56">
      <PortfolioCalendarBars data={data} />
    </div>
  )
}
