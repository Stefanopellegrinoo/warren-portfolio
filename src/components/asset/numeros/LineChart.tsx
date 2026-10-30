'use client'

import { useState } from 'react'
import type { MetricUnit } from '@/lib/fundamentals/catalog'
import { formatMetric, periodLabel } from '@/lib/fundamentals/explain'
import { formatNumber } from '@/lib/utils'
import { bestPoint, type PeriodMode } from '@/lib/fundamentals/metrics'
import type { Series } from '@/lib/fundamentals/types'

/** 1, 2, 2,5 or 5 × 10ⁿ: about four gridlines over `span`. */
function niceStep(span: number): number {
  const raw = span / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map((k) => k * pow).find((s) => s >= raw)!
}

/**
 * A metric through time (odd/tasks/asset-page.md T6, S3): the line over a filled area, a dashed
 * zero when the range crosses it, the best point marked, the "hoy" point at the end, and the
 * period and value under the pointer. The SVG stretches to its box; dots and labels are HTML, so
 * they keep their shape at any width.
 */
export function LineChart({ series, unit, better, mode, today, label }: {
  series: Series
  unit: MetricUnit
  better: 'higher' | 'lower'
  mode: PeriodMode
  today: string | null
  label: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  if (series.length === 0) return <p className="py-10 text-center text-sm text-ink-3">Sin datos en este período.</p>

  const fmt = (v: number) => formatMetric(v, unit)
  const name = (end: string) => periodLabel(end, mode, today)
  const times = series.map((p) => Date.parse(p.end))
  const t0 = times[0]
  const span = times[times.length - 1] - t0 || 1
  const values = series.map((p) => p.value)
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.12 || 1
  lo -= pad
  hi += pad
  const x = (i: number) => ((times[i] - t0) / span) * 100
  const y = (v: number) => ((hi - v) / (hi - lo)) * 100
  const base = y(Math.min(Math.max(0, lo), hi))
  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join('')
  const step = niceStep(hi - lo)
  const ticks = Array.from({ length: Math.floor(hi / step) - Math.ceil(lo / step) + 1 }, (_, k) => (Math.ceil(lo / step) + k) * step)
  const firstYear = new Date(t0).getUTCFullYear() + 1
  const years = Array.from({ length: new Date(t0 + span).getUTCFullYear() - firstYear + 1 }, (_, k) => firstYear + k)
  const dec = [0, 1, 2].find((d) => Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-9) ?? 2
  // Axis labels are short: millions without "US$ … M" (the header carries the unit), percent with "%".
  const tick = (t: number) =>
    unit === 'usd' ? formatNumber(t / 1e6, { decimals: 0 }) : `${formatNumber(t, { decimals: dec })}${unit === 'percent' ? ' %' : ''}`
  const best = bestPoint(series, better)!
  const last = series.length - 1
  const shown = hover !== null && hover <= last ? hover : null

  function pick(e: React.PointerEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    const at = ((e.clientX - box.left) / box.width) * 100
    setHover(series.reduce((near, _, i) => (Math.abs(x(i) - at) < Math.abs(x(near) - at) ? i : near), 0))
  }

  const dot = (i: number, className: string) => (
    <span aria-hidden="true" className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface ${className}`} style={{ left: `${x(i)}%`, top: `${y(series[i].value)}%` }} />
  )

  return (
    <div className="pl-11 pr-2">
      <div
        role="img"
        aria-label={`${label}: de ${fmt(series[0].value)} en ${name(series[0].end)} a ${fmt(series[last].value)} ${series[last].end === today ? 'hoy' : `en ${name(series[last].end)}`}. ${better === 'higher' ? 'Máximo' : 'Mínimo'}: ${fmt(best.value)} en ${name(best.end)}.`}
        data-points={series.length}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
        className="relative h-44 touch-pan-y select-none lg:h-48"
      >
        {ticks.map((t) => (
          <span key={t} aria-hidden="true" className="absolute -left-11 w-10 -translate-y-1/2 text-right font-mono text-[10px] text-ink-3" style={{ top: `${y(t)}%` }}>
            {tick(t)}
          </span>
        ))}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 h-full w-full overflow-visible">
          {ticks.map((t) => (
            <line key={t} x1="0" x2="100" y1={y(t)} y2={y(t)} vectorEffect="non-scaling-stroke" className={t === 0 ? 'stroke-line-strong' : 'stroke-line'} strokeDasharray={t === 0 ? '4 3' : undefined} />
          ))}
          <path d={`${line}L${x(last)},${base}L0,${base}Z`} className="fill-accent-soft" />
          <path d={line} fill="none" vectorEffect="non-scaling-stroke" strokeWidth="2" strokeLinejoin="round" className="stroke-accent" />
          {shown !== null && <line x1={x(shown)} x2={x(shown)} y1="0" y2="100" vectorEffect="non-scaling-stroke" className="stroke-ink-3" />}
        </svg>
        {dot(series.indexOf(best), 'bg-ink')}
        {dot(last, 'bg-accent')}
        {shown !== null && (
          <span
            className="pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded bg-ink px-2 py-1 text-[11px] leading-tight text-canvas"
            style={{ left: `${x(shown)}%`, transform: `translateX(${x(shown) > 60 ? '-105%' : '5%'})` }}
          >
            {name(series[shown].end)}
            <b className="block font-mono">{fmt(series[shown].value)}</b>
          </span>
        )}
      </div>
      <div aria-hidden="true" className="relative mt-1 h-4 font-mono text-[10px] text-ink-3">
        {years.map((yr) => {
          const at = ((Date.UTC(yr, 0, 1) - t0) / span) * 100
          return <span key={yr} className="absolute -translate-x-1/2" style={{ left: `${at}%` }}>{yr}</span>
        })}
      </div>
    </div>
  )
}
