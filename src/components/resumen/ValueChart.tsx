'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn, formatNumber } from '@/lib/utils'
import { buildChart, HISTORY_NOTE, nearestIndex, PLOT, RANGES, type HistoryPoint, type RangeId } from '@/lib/resumen/chart'

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; points: HistoryPoint[] }

const longDate = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

export default function ValueChart() {
  const [range, setRange] = useState<RangeId>('3M')
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [width, setWidth] = useState(0)
  const [active, setActive] = useState<number | null>(null)
  const wrap = useRef<HTMLDivElement>(null)

  // Each request carries its own range; a late answer for an older range is dropped.
  const latest = useRef<RangeId>(range)

  const fetchHistory = useCallback((r: RangeId) => {
    latest.current = r
    const days = RANGES.find(x => x.id === r)!.days
    fetch(`/api/portfolio-history?days=${days}&universe=total`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((d: { data?: HistoryPoint[] }) => { if (latest.current === r) setLoad({ status: 'ready', points: d.data ?? [] }) })
      .catch(() => { if (latest.current === r) setLoad({ status: 'error' }) })
  }, [])

  useEffect(() => { fetchHistory(range) }, [range, fetchHistory])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function changeRange(r: RangeId) {
    setLoad({ status: 'loading' })
    setActive(null)
    setRange(r)
  }

  const points = load.status === 'ready' ? load.points : []
  const height = width && width < 560 ? 180 : 220
  const chart = width ? buildChart(points, width, height) : null
  const point = active !== null ? points[active] : null

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const from = active ?? points.length - 1
    setActive(Math.min(Math.max(from + (e.key === 'ArrowLeft' ? -1 : 1), 0), points.length - 1))
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
              <input type="radio" name="value-range" value={r.id} checked={range === r.id} onChange={() => changeRange(r.id)} className="absolute inset-0 m-0 cursor-pointer opacity-0" />
              {r.id}
            </label>
          ))}
        </fieldset>
        <div className="flex gap-4 text-[13px] text-ink-3" aria-hidden="true">
          <span><i className="mr-1.5 inline-block w-3.5 border-t-2 border-accent align-middle" />Valor</span>
          <span><i className="mr-1.5 inline-block w-3.5 border-t border-dashed border-ink-3 align-middle" />Invertido</span>
        </div>
      </div>

      <div ref={wrap} className="relative mt-3" style={{ minHeight: height }}>
        {load.status === 'loading' && <span className="block animate-pulse rounded bg-surface-2" style={{ height }} aria-label="Cargando historia" role="status" />}

        {load.status === 'error' && (
          <div className="flex items-center gap-3 py-8 text-sm text-ink-2" role="alert">
            No se pudo cargar la historia.
            <button type="button" onClick={() => { setLoad({ status: 'loading' }); fetchHistory(range) }} className="font-medium text-accent-ink underline underline-offset-2">
              Reintentar
            </button>
          </div>
        )}

        {load.status === 'ready' && !chart && width > 0 && (
          <p className="py-8 text-sm text-ink-3">Todavía no hay historia para este período.</p>
        )}

        {load.status === 'ready' && chart && (
          <>
            <svg
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              tabIndex={0}
              role="img"
              aria-label={`Valor de la cartera, período ${range}. Usá las flechas para recorrer los días.`}
              onKeyDown={onKeyDown}
              onFocus={() => setActive(a => a ?? points.length - 1)}
              onBlur={() => setActive(null)}
              onPointerMove={e => {
                const r = e.currentTarget.getBoundingClientRect()
                setActive(nearestIndex(e.clientX, r.left + PLOT.left, r.width - PLOT.left, points.length))
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
                className={cn('pointer-events-none absolute top-0 whitespace-nowrap rounded-md border border-line bg-surface px-3 py-2 text-[13px] shadow-pop')}
                style={chart.xAt(active) > width / 2 ? { right: width - chart.xAt(active) + 12 } : { left: chart.xAt(active) + 12 }}
              >
                <span className="block text-ink-3">{longDate(point.snapshot_date)}</span>
                <b className="block text-sm font-semibold">US$ {formatNumber(point.value)}</b>
                <span className={point.value - point.invested >= 0 ? 'text-ok' : 'text-danger'}>
                  {formatNumber(point.value - point.invested, { sign: true })} sobre lo invertido
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {load.status === 'ready' && points.length > 0 && <p className="mt-2 text-[13px] text-ink-3">{HISTORY_NOTE}</p>}
    </div>
  )
}
