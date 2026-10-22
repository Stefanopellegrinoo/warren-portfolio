'use client'

import { useState, useEffect } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import type { BenchmarkComparison as Comparison } from '@/lib/benchmark'
import { SectionHead } from '@/components/resumen/ui'
import { formatNumber } from '@/lib/utils'
import { AXIS, GRID, TOOLTIP } from './tokens'

const OPTIONS = [
  { value: '', label: 'Ninguno' },
  { value: 'MERV_CCL', label: 'MERVAL (USD CCL)' },
  { value: 'SPY', label: 'S&P 500 (SPY)' },
  { value: 'QQQ', label: 'Nasdaq 100 (QQQ)' },
]
const pct = (v: number) => `${formatNumber(v, { decimals: 1, sign: true })} %`
const utcDate = (v: string) => new Date(v).toLocaleDateString('es-AR', { timeZone: 'UTC' })

/** Portfolio TWR vs one benchmark, for the statistics universe of the active tab. */
export default function BenchmarkComparison({ universe }: { universe: string }) {
  const [benchmark, setBenchmark] = useState('')
  const [result, setResult] = useState<Comparison | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setResult(null)
    setFailed(false)
    if (!benchmark) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/statistics?universe=${universe}&benchmark=${benchmark}`)
      .then(async (res) => {
        const body = res.ok ? await res.json() : null
        if (cancelled) return
        setResult(body?.benchmark ?? null)
        setFailed(!body || body.benchmarkError === true || !body.benchmark)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [benchmark, universe])

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
      <p className="pt-3 text-[13px] text-ink-3">Retorno ponderado por tiempo, sin depósitos ni retiros, contra el índice elegido, en USD.</p>

      {benchmark && loading && <p role="status" className="pt-3 text-sm text-ink-3">Cargando…</p>}
      {benchmark && !loading && failed && (
        <p role="alert" className="mt-3 rounded-md bg-warn-soft px-4 py-3 text-sm text-warn">El índice no está disponible ahora.</p>
      )}
      {result && !loading && (() => {
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
            <div className="mt-3 flex gap-4 text-[13px] text-ink-3" aria-hidden="true">
              <span><i className="mr-1.5 inline-block w-3.5 border-t-2 border-accent align-middle" />Cartera</span>
              <span><i className="mr-1.5 inline-block w-3.5 border-t border-dashed border-ink-3 align-middle" />{result.label}</span>
            </div>
            <div className="mt-2 h-[240px] max-[819px]:h-[180px]">
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
            </div>
          </>
        )
      })()}
    </section>
  )
}
