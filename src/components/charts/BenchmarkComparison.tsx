'use client'

import { useState, useEffect } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import type { BenchmarkComparison as Comparison } from '@/lib/benchmark'

const OPTIONS = [
  { value: '', label: 'Ninguno' },
  { value: 'MERV_CCL', label: 'MERVAL (USD CCL)' },
  { value: 'SPY', label: 'S&P 500 (SPY)' },
  { value: 'QQQ', label: 'Nasdaq 100 (QQQ)' },
]
const TOOLTIP_STYLE = { backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }
const AXIS_TICK = { fill: '#475569', fontSize: 10, fontFamily: 'var(--font-mono)' }
const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

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
    <div className="glass rounded-2xl p-4 md:p-5 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display font-700 text-white">Comparar con benchmark</h3>
          <p className="text-[11px] text-slate-500 font-mono">Retorno ponderado por tiempo (sin depósitos ni retiros) vs. índice, en USD</p>
        </div>
        <select
          value={benchmark}
          onChange={(e) => setBenchmark(e.target.value)}
          className="glass rounded-lg px-3 py-2 font-mono text-sm text-slate-200 bg-transparent"
          aria-label="Benchmark"
        >
          {OPTIONS.map((o) => <option key={o.value} value={o.value} className="bg-slate-900">{o.label}</option>)}
        </select>
      </div>

      {benchmark && loading && <p className="text-[11px] text-slate-500 font-mono mt-3">Cargando…</p>}
      {benchmark && !loading && failed && (
        <p className="text-[11px] text-amber/70 font-mono mt-3">Benchmark no disponible</p>
      )}
      {result && !loading && (() => {
        // Round before the sign check, or a -2e-14 renders as a rose "-0.0 pp". `|| 0` drops -0.
        const excess = Math.round(result.excessPp * 10) / 10 || 0
        const since = new Date(result.points[0].date).toLocaleDateString('es-AR', { timeZone: 'UTC' })
        return (
        <>
          <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mt-4">Exceso vs benchmark · desde {since}</p>
          <p className={`font-display font-700 text-xl ${excess >= 0 ? 'text-emerald' : 'text-rose'}`}>
            {excess >= 0 ? '+' : ''}{excess.toFixed(1)} pp
          </p>
          <div className="h-[260px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={result.points}>
                <CartesianGrid strokeDasharray="3 3" stroke="#132035" vertical={false} />
                <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={24}
                  tickFormatter={(v: string) => { const d = new Date(v); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}` }} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                <Tooltip formatter={(v: number) => pct(v)} contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(l: string) => new Date(l).toLocaleDateString('es-AR', { timeZone: 'UTC' })} />
                <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} />
                <Line type="monotone" dataKey="portfolioPct" name="Cartera (TWR)" stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="benchmarkPct" name={result.label} stroke="#F59E0B" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
        )
      })()}
    </div>
  )
}
