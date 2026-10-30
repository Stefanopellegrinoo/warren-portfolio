'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import type { AssetPage } from '@/lib/fundamentals/service'
import { METRICS, type MetricId } from '@/lib/fundamentals/catalog'
import { basisLabel, explain, formatMetric, howItGoes, shortName } from '@/lib/fundamentals/explain'
import { PERIOD_MODES, changeVsYearAgo, type MetricValue, type PeriodMode } from '@/lib/fundamentals/metrics'
import { Segmented } from '@/components/strategies/ui'
import { cn, formatNumber } from '@/lib/utils'
import { LineChart } from './LineChart'

const MODE_LABELS: Record<PeriodMode, string> = { quarterly: 'Trimestral', ttm: 'Últimos 12 meses', annual: 'Anual' }
const RANGES = [{ value: '2', label: '2 años' }, { value: '5', label: '5 años' }, { value: '8', label: '8 años' }] as const
type Range = (typeof RANGES)[number]['value']
const DAY_MS = 86_400_000
// A series that starts within about a quarter of the range's start covers it.
const COVERS_DAYS = 111

/** The "hoy" point's date: the only end after `asOf`, the latest period's (a quarterly flow has none). */
export const todayOf = (m: MetricValue): string | null =>
  m.asOf === null ? null : PERIOD_MODES.map((k) => m.history[k].at(-1)?.end).find((end) => end !== undefined && end > m.asOf!) ?? null

/** A peer's name as a reader says it. */
export const peerName = (p: AssetPage['peers'][number]) => shortName(p.name ?? p.tvSymbol.split(':').pop()!)

/**
 * One metric's history (odd/tasks/asset-page.md T6, S3 S4): value and change in a year, period
 * and range, the chart, "¿Qué es?", "¿Cómo viene?" and the peers. A sticky panel on desktop; on
 * a phone (`full`) a screen of its own with "‹ Números".
 */
export function HistoryPanel({ page, id, full, onBack, className }: {
  page: AssetPage
  id: MetricId
  full: boolean
  onBack: () => void
  className?: string
}) {
  const def = METRICS.find((d) => d.id === id)!
  const m = page.metrics![id]
  const name = shortName(page.name)
  const better = 'better' in def ? def.better : 'higher'
  // Null until the reader picks one: then the metric's own default.
  const [mode, setMode] = useState<PeriodMode | null>(null)
  const [range, setRange] = useState<Range>('8')
  const radios = useId()
  const box = useRef<HTMLElement>(null)
  const back = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!full) return
    box.current?.scrollTo?.(0, 0)
    back.current?.focus()
  }, [full, id])

  const modes = PERIOD_MODES.filter((k) => m.history[k].length > 0)
  const today = todayOf(m)
  // Últimos 12 meses, unless it has a single period (Yahoo's five quarters make one TTM): then the longest.
  const periods = (k: PeriodMode) => m.history[k].filter((p) => p.end !== today).length
  const longest = [...modes].sort((a, b) => periods(b) - periods(a))[0]
  const shown = mode && modes.includes(mode) ? mode : periods('ttm') >= 2 ? 'ttm' : longest
  let series = m.history[shown] ?? []
  const ref = series.at(-1)?.end
  const start = ref ? `${Number(ref.slice(0, 4)) - Number(range)}${ref.slice(4)}` : ''
  series = series.filter((p) => p.end >= start)
  const since = series[0] && (Date.parse(series[0].end) - Date.parse(start)) / DAY_MS > COVERS_DAYS ? series[0].end.slice(0, 4) : null

  const change = changeVsYearAgo(m.history.ttm.length ? m.history.ttm : m.history[shown] ?? [], def.unit, m.asOf)
  const basis = m.history.ttm.filter((p) => p.end !== today).at(-1)
  const e = explain(id, name, m.today)

  const rows = [
    { name, value: m.today, self: true },
    ...page.peers.map((p) => ({ name: peerName(p), value: p.today[id], self: false })).filter((r) => r.value !== null),
  ].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))
  const max = Math.max(...rows.map((r) => Math.abs(r.value ?? 0))) || 1

  return (
    <section
      ref={box}
      data-slot="history-panel"
      aria-label={`Historia de ${def.label}`}
      className={cn('rounded-lg border border-line bg-surface p-4 max-lg:rounded-none max-lg:border-0 lg:p-5', className)}
    >
      {full && (
        <button ref={back} type="button" onClick={onBack} className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-0.5 rounded-md px-2 text-[15px] font-medium text-accent-ink hover:underline lg:hidden">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Números
        </button>
      )}
      <div className="lg:flex lg:items-start lg:justify-between lg:gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold leading-tight">{def.label}</h2>
          <p className="mt-1 text-sm text-ink-2">{basisLabel(id, basis?.end ?? null)}</p>
        </div>
        <div className="max-lg:mt-2 lg:shrink-0 lg:text-right">
          <p className="font-mono text-2xl font-semibold leading-tight">{formatMetric(m.today, def.unit)}</p>
          {change !== null && (
            <p className={cn('mt-0.5 font-mono text-sm font-medium', change < 0 ? 'text-danger' : change > 0 ? 'text-ok' : 'text-ink-3')}>
              <span aria-hidden="true">{change < 0 ? '▼ ' : change > 0 ? '▲ ' : ''}</span>
              {change < 0 ? <span className="sr-only">bajó </span> : change > 0 ? <span className="sr-only">subió </span> : null}
              {formatNumber(Math.abs(change), { decimals: 1 })}
              {def.unit === 'percent' ? ' puntos' : ' %'} en un año
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {modes.length > 1 && (
          <Segmented name={`${radios}-mode`} legend="Período" value={shown} onChange={setMode} options={modes.map((k) => ({ value: k, label: MODE_LABELS[k] }))} />
        )}
        <Segmented name={`${radios}-range`} legend="Rango" value={range} onChange={setRange} options={[...RANGES]} />
      </div>

      <div className="mt-4">
        <LineChart key={`${id}-${shown}-${range}`} series={series} unit={def.unit} better={better} mode={shown} today={today} label={def.label} />
        {since && <p className="mt-1 text-sm text-ink-3">Historia desde {since}.</p>}
      </div>

      {/* Side by side only where each still holds a comfortable line; never wider than about 65 characters. */}
      <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-1">
        <div className="max-w-prose rounded-md border border-line p-3 text-[15px] leading-relaxed text-ink-2">
          <b className="text-ink">¿Qué es?</b> {e.what} {e.read}
        </div>
        <div className="max-w-prose rounded-md border border-line p-3 text-[15px] leading-relaxed text-ink-2">
          <b className="text-ink">¿Cómo viene?</b> {howItGoes(id, series, shown, today, m.asOf).join(' ')}
        </div>
      </div>

      <h3 className="mt-6 text-[17px] font-semibold">Contra sus parecidas</h3>
      {rows.length > 1 ? (
        <ol className="mt-3 grid gap-2.5">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} data-slot="peer-bar" data-self={r.self || undefined} className={cn('grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-[15px]', r.self && 'font-semibold')}>
              <span className="break-words leading-tight">{r.name}</span>
              <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-surface-2">
                <span
                  className={cn('block h-full rounded-full', r.value !== null && r.value < 0 ? 'bg-danger-dot' : r.self ? 'bg-accent' : 'bg-line-strong')}
                  style={{ width: `${(Math.abs(r.value ?? 0) / max) * 100}%` }}
                />
              </span>
              <span className="text-right font-mono">{formatMetric(r.value, def.unit)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-[15px] text-ink-2">Sin datos de sus parecidas para este número.</p>
      )}
    </section>
  )
}
