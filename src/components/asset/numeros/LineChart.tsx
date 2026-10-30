'use client'

import { useState } from 'react'
import type { MetricUnit } from '@/lib/fundamentals/catalog'
import { formatMetric, periodLabel } from '@/lib/fundamentals/explain'
import { formatNumber } from '@/lib/utils'
import { bestPoint, type PeriodMode } from '@/lib/fundamentals/metrics'
import type { Series } from '@/lib/fundamentals/types'

const DAY_MS = 86_400_000
/** More than 1,5 periods apart is a gap: the line breaks there instead of joining across it. */
const GAP_DAYS: Record<PeriodMode, number> = { quarterly: 137, ttm: 137, annual: 548 }

/**
 * The range the axis shows: every value but the far ones, past the quartiles by more than twice the
 * interquartile range (MELI's P/E of 1.925,9 next to years of 45–80). Those are pinned to the edge.
 */
function shownRange(values: number[]): [number, number] {
  const s = [...values].sort((a, b) => a - b)
  const q = (p: number) => {
    const i = p * (s.length - 1)
    const f = Math.floor(i)
    return s[f] + (s[Math.ceil(i)] - s[f]) * (i - f)
  }
  const iqr = q(0.75) - q(0.25)
  const kept = iqr > 0 ? s.filter((v) => v >= q(0.25) - 2 * iqr && v <= q(0.75) + 2 * iqr) : s
  return [kept[0], kept[kept.length - 1]]
}

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
  const [low, high] = shownRange(series.map((p) => p.value))
  const pad = (high - low) * 0.12 || Math.abs(high) * 0.12 || 1
  const lo = low - pad
  const hi = high + pad
  const x = (i: number) => ((times[i] - t0) / span) * 100
  // A value past the shown range sits on the edge.
  const y = (v: number) => ((hi - Math.min(Math.max(v, lo), hi)) / (hi - lo)) * 100
  const base = y(Math.min(Math.max(0, lo), hi))
  // Runs of consecutive periods; hoy always continues the last one.
  const runs: number[][] = []
  series.forEach((p, i) => {
    if (i === 0 || (p.end !== today && times[i] - times[i - 1] > GAP_DAYS[mode] * DAY_MS)) runs.push([i])
    else runs[runs.length - 1].push(i)
  })
  const path = (run: number[]) => run.map((i, k) => `${k ? 'L' : 'M'}${x(i)},${y(series[i].value)}`).join('')
  const line = runs.map(path).join('')
  const area = runs.map((run) => `${path(run)}L${x(run[run.length - 1])},${base}L${x(run[0])},${base}Z`).join('')
  const pinned = series.flatMap((p, i) => (p.value < low || p.value > high ? [i] : []))
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
    <span key={`${i}-${className}`} aria-hidden="true" className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${className}`} style={{ left: `${x(i)}%`, top: `${y(series[i].value)}%` }} />
  )
  const at = (end: string) => (end === today ? 'hoy' : `en ${name(end)}`)
  const outside = pinned.map((i) => `${fmt(series[i].value)} ${at(series[i].end)}`).join(', ')

  return (
    <div className="pl-11 pr-2">
      <div
        role="img"
        aria-label={`${label}: de ${fmt(series[0].value)} ${at(series[0].end)} a ${fmt(series[last].value)} ${at(series[last].end)}. ${better === 'higher' ? 'Máximo' : 'Mínimo'}: ${fmt(best.value)} ${at(best.end)}.${outside ? ` Fuera de escala: ${outside}.` : ''}`}
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
          <path d={area} className="fill-accent-soft" />
          <path d={line} fill="none" vectorEffect="non-scaling-stroke" strokeWidth="2" strokeLinejoin="round" className="stroke-accent" />
          {shown !== null && <line x1={x(shown)} x2={x(shown)} y1="0" y2="100" vectorEffect="non-scaling-stroke" className="stroke-ink-3" />}
        </svg>
        {runs.filter((run) => run.length === 1).map(([i]) => dot(i, 'h-1.5 w-1.5 bg-accent'))}
        {pinned.map((i) => (
          <span
            key={i}
            data-slot="clipped"
            aria-hidden="true"
            className={`absolute -translate-x-1/2 text-[9px] leading-none text-accent-ink ${series[i].value > high ? '' : '-translate-y-full'}`}
            style={{ left: `${x(i)}%`, top: series[i].value > high ? '0%' : '100%' }}
          >
            {series[i].value > high ? '▲' : '▼'}
          </span>
        ))}
        {dot(series.indexOf(best), 'h-2.5 w-2.5 ring-2 ring-surface bg-ink')}
        {dot(last, 'h-2.5 w-2.5 ring-2 ring-surface bg-accent')}
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
