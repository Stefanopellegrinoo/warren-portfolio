'use client'

import { useEffect, useRef, useState } from 'react'
import { formatNumber } from '@/lib/utils'
import { buildChart, nearestIndex, PLOT, RANGES } from '@/lib/resumen/chart'

/**
 * What the chart actually consumes. Declared here rather than reusing
 * PortfolioSnapshot: a component should state its own contract instead of
 * dragging the shape of a database table through the app, and the history
 * endpoint sends fewer fields than that table has.
 */
export interface PortfolioChartPoint {
  snapshot_date: string
  value: number
  invested: number
}

type Period = '30' | '90' | '180' | '365' | 'all'

interface Props {
  data: PortfolioChartPoint[]
  period: Period
  onPeriodChange: (p: Period) => void
  /** Skeleton instead of the plot while the parent fetches the series. */
  loading?: boolean
  /** What the second line is, and how the gap to it reads in the tooltip. */
  line: { label: string; delta: string }
}

const longDate = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

/** Value against a second line (money put in, or cost), same drawing as the Resumen chart. */
export default function PortfolioChart({ data, period, onPeriodChange, loading = false, line }: Props) {
  const [width, setWidth] = useState(0)
  const [active, setActive] = useState<number | null>(null)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => setActive(null), [data])

  const height = width && width < 560 ? 180 : 220
  const chart = !loading && width && data.length >= 2 ? buildChart(data, width, height) : null
  const point = active !== null ? data[active] : null
  const label = RANGES.find(r => r.days === period)?.id ?? period

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const from = active ?? data.length - 1
    setActive(Math.min(Math.max(from + (e.key === 'ArrowLeft' ? -1 : 1), 0), data.length - 1))
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
        <fieldset className="inline-flex gap-0.5 rounded-md border border-line bg-surface-2 p-0.5" aria-label="Período del gráfico">
          {RANGES.map(r => (
            <label
              key={r.id}
              className="relative inline-flex min-h-8 cursor-pointer items-center rounded px-3 text-[13px] text-ink-2 has-[:checked]:bg-surface has-[:checked]:text-ink has-[:checked]:shadow-[0_0_0_1px_var(--line)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring max-[819px]:min-h-11 max-[819px]:px-2.5"
            >
              <input type="radio" name="evolution-range" value={r.days} checked={period === r.days} onChange={() => onPeriodChange(r.days)} className="absolute inset-0 m-0 cursor-pointer opacity-0" />
              {r.id}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-3" aria-hidden="true">
          <span><i className="mr-1.5 inline-block w-3.5 border-t-2 border-accent align-middle" />Valor</span>
          <span><i className="mr-1.5 inline-block w-3.5 border-t border-dashed border-ink-3 align-middle" />{line.label}</span>
        </div>
      </div>

      <div ref={wrap} className="relative mt-3" style={{ minHeight: height }}>
        {loading && <span className="block animate-pulse rounded bg-surface-2" style={{ height }} aria-label="Cargando historia" role="status" />}

        {!loading && data.length < 2 && (
          <p className="py-8 text-sm text-ink-3">Todavía no hay historia suficiente para este período.</p>
        )}

        {chart && (
          <>
            <svg
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              tabIndex={0}
              role="img"
              aria-label={`Valor de la cartera contra lo invertido, período ${label}. Usá las flechas para recorrer los días.`}
              onKeyDown={onKeyDown}
              onFocus={() => setActive(a => a ?? data.length - 1)}
              onBlur={() => setActive(null)}
              onPointerMove={e => {
                const r = e.currentTarget.getBoundingClientRect()
                setActive(nearestIndex(e.clientX, r.left + PLOT.left, r.width - PLOT.left, data.length))
              }}
              onPointerLeave={() => setActive(null)}
              className="block overflow-visible"
            >
              {chart.yTicks.map(t => (
                <g key={t.label}>
                  <line x1={PLOT.left} x2={width} y1={t.y} y2={t.y} stroke="var(--line)" />
                  <text x={0} y={t.y + 4} fill="var(--ink-3)" fontSize={11}>{t.label}</text>
                </g>
              ))}
              {chart.xTicks.map((t, i) => (
                <text key={i} x={t.x} y={height - 4} fill="var(--ink-3)" fontSize={11}
                  textAnchor={i === 0 ? 'start' : i === chart.xTicks.length - 1 ? 'end' : 'middle'}>{t.label}</text>
              ))}
              <path d={chart.investedPath} fill="none" stroke="var(--ink-3)" strokeDasharray="3 4" />
              <path d={chart.valuePath} fill="none" stroke="var(--accent)" strokeWidth={1.75} strokeLinejoin="round" />
              {point && active !== null && (
                <>
                  <line x1={chart.xAt(active)} x2={chart.xAt(active)} y1={PLOT.top} y2={height - PLOT.bottom} stroke="var(--line-strong)" />
                  <circle cx={chart.xAt(active)} cy={chart.yAt(point.value)} r={3.5} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} />
                </>
              )}
            </svg>

            {point && active !== null && (
              <div
                aria-live="polite"
                className="pointer-events-none absolute top-0 whitespace-nowrap rounded-md border border-line bg-surface px-3 py-2 text-[13px] shadow-pop"
                style={chart.xAt(active) > width / 2 ? { right: width - chart.xAt(active) + 12 } : { left: chart.xAt(active) + 12 }}
              >
                <span className="block text-ink-3">{longDate(point.snapshot_date)}</span>
                <b className="block text-sm font-semibold">US$ {formatNumber(point.value)}</b>
                <span className="block text-ink-2">{line.label} US$ {formatNumber(point.invested)}</span>
                <span className={point.value - point.invested >= 0 ? 'text-ok' : 'text-danger'}>
                  {formatNumber(point.value - point.invested, { sign: true })} {line.delta}
                </span>
              </div>
            )}
          </>
        )}
      </div>

    </div>
  )
}
