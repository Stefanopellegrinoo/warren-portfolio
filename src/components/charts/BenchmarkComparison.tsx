'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import type { BenchmarkComparison as Comparison } from '@/lib/benchmark'
import { SectionHead } from '@/components/resumen/ui'
import { formatNumber } from '@/lib/utils'
import ChartPlaceholder from './ChartPlaceholder'
import { useCachedPerVisit } from './use-cached-per-visit'

// recharts arrives with the chart, not with the page (odd/tasks/rendimiento.md S9).
const BenchmarkChart = dynamic(() => import('./BenchmarkChart'), { ssr: false, loading: ChartPlaceholder })

const OPTIONS = [
  { value: '', label: 'Ninguno' },
  { value: 'MERV_CCL', label: 'MERVAL (USD CCL)' },
  { value: 'SPY', label: 'S&P 500 (SPY)' },
  { value: 'QQQ', label: 'Nasdaq 100 (QQQ)' },
]
const utcDate = (v: string) => new Date(v).toLocaleDateString('es-AR', { timeZone: 'UTC' })

/** Portfolio TWR vs one benchmark, for the statistics universe of the active tab. */
export default function BenchmarkComparison({ universe }: { universe: string }) {
  const [benchmark, setBenchmark] = useState('')
  // One request per part and index per visit: switching tabs back and forth asks nothing again (S9).
  const comparison = useCachedPerVisit(benchmark ? `statistics:benchmark:${universe}:${benchmark}` : null, async (): Promise<Comparison> => {
    const res = await fetch(`/api/statistics?universe=${universe}&benchmark=${benchmark}`)
    const body = res.ok ? await res.json() : null
    if (!body || body.benchmarkError === true || !body.benchmark) throw new Error('benchmark unavailable')
    return body.benchmark
  })
  const result = comparison.data ?? null
  const loading = !result && comparison.loading
  const failed = !result && !!comparison.error

  return (
    <section aria-labelledby="h-benchmark">
      <SectionHead
        id="h-benchmark"
        title="Comparar con un índice"
        action={
          <select
            value={benchmark}
            onChange={(e) => setBenchmark(e.target.value)}
            className="min-h-8 max-w-[11rem] rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink hover:bg-hover max-[819px]:min-h-11"
            aria-label="Índice de comparación"
          >
            {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        }
      />
      <p className="pt-3 text-[13px] text-ink-3">Retorno ponderado por tiempo, sin depósitos ni retiros, contra el índice elegido con sus dividendos reinvertidos, en USD.</p>

      {benchmark && loading && <p role="status" className="pt-3 text-sm text-ink-3">Cargando…</p>}
      {benchmark && !loading && failed && (
        <p role="alert" className="mt-3 rounded-md bg-warn-soft px-4 py-3 text-sm text-warn">El índice no está disponible ahora.</p>
      )}
      {result && (() => {
        // Round before the sign check, or a -2e-14 renders as a red "−0,0 pp". `|| 0` drops -0.
        const excess = Math.round(result.excessPp * 10) / 10 || 0
        return (
          <>
            <dl className="pt-4">
              <dt className="text-[13px] text-ink-3">Diferencia contra el índice desde el {utcDate(result.points[0].date)}</dt>
              <dd className={`text-base font-medium tabular-nums ${excess > 0 ? 'text-ok' : excess < 0 ? 'text-danger' : 'text-ink'}`}>
                {formatNumber(excess, { decimals: 1, sign: true })} pp
              </dd>
            </dl>
            {result.priceOnly && <p className="pt-1 text-[13px] text-ink-3">El MERVAL no publica dividendos: se compara solo su precio.</p>}
            <div className="mt-3 flex gap-4 text-[13px] text-ink-3" aria-hidden="true">
              <span><i className="mr-1.5 inline-block w-3.5 border-t-2 border-accent align-middle" />Cartera</span>
              <span><i className="mr-1.5 inline-block w-3.5 border-t border-dashed border-ink-3 align-middle" />{result.label}</span>
            </div>
            <div className="mt-2 h-[240px] max-[819px]:h-[180px]">
              <BenchmarkChart result={result} />
            </div>
          </>
        )
      })()}
    </section>
  )
}
