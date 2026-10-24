'use client'

import dynamic from 'next/dynamic'
import ChartPlaceholder from '@/components/charts/ChartPlaceholder'
import type { PricePoint } from '@/lib/on-catalog'
import { fmtDate, fmtNum } from '@/lib/on-format'

// recharts arrives with the chart, not with the page (odd/tasks/rendimiento.md S9).
const OnPriceLines = dynamic(() => import('./OnPriceLines'), { ssr: false, loading: ChartPlaceholder })

export default function OnPriceChart({ history, ticker }: { history: PricePoint[]; ticker: string | null }) {
  if (history.length < 2) {
    return <p className="text-ink-3">Todavía no hay historial de precio para esta ON. Se acumula con el cierre de cada rueda.</p>
  }
  const first = history[0]
  const last = history[history.length - 1]
  const label = `Precio sucio de ${ticker ?? 'la ON'} entre ${fmtDate(first.date)} y ${fmtDate(last.date)}: de ${fmtNum(first.close)} a ${fmtNum(last.close)}`
  return (
    <div role="img" aria-label={label} className="h-56 w-full max-[819px]:h-[180px]">
      <OnPriceLines history={history} />
    </div>
  )
}
