'use client'

import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useCached } from '@/lib/client-cache'
import { requestErrorMessage } from '@/lib/request-errors'
import { apiData } from '@/components/ons/portfolios/api'
import { Loading, LoadError } from '@/components/ons/ui'
import { Segmented, StrategyDialog } from '@/components/strategies/ui'
import { Dialog } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatMetric, periodLabel, shortName } from '@/lib/fundamentals/explain'
import { changeVsYearAgo } from '@/lib/fundamentals/metrics'
import {
  MAX_YEARS, STATEMENTS, columnOf, isGap, tableOf, trend,
  type AssetStatements, type StatementId, type StatementMode, type StatementRow, type StatementTable,
} from '@/lib/fundamentals/statements'
import type { AssetPage } from '@/lib/fundamentals/service'
import { cn, formatNumber } from '@/lib/utils'
import { LineChart } from './LineChart'

const MODES = [{ value: 'quarterly', label: 'Trimestral' }, { value: 'annual', label: 'Anual' }] as const
// "Todo": since the SEC's first year (T12), offered only with SEC rows.
const RANGES = [{ value: '5', label: '5 años' }, { value: '8', label: `${MAX_YEARS} años` }, { value: 'all', label: 'Todo' }] as const
type Range = (typeof RANGES)[number]['value']
const FAILED = 'No pudimos traer los balances.'
const SOURCE_NAMES: Record<StatementRow['source'], string> = { sec: 'SEC (EDGAR)', tradingview: 'TradingView', yahoo: 'Yahoo Finance' }

/** A cell: US$ millions (the header says so), EPS in US$ (the route converts it), shares in millions. */
function cellText(value: number, row: StatementRow): string {
  if (row.def.unit === 'perShare') return formatMetric(value, 'price')
  if (row.def.unit === 'count') return formatMetric(value, 'count')
  const m = value / 1e6
  return formatNumber(m, { decimals: Math.abs(m) < 10 ? 1 : 0 })
}

const chartUnit = (row: StatementRow) => (row.def.unit === 'perShare' ? 'usdPerShare' : row.def.unit === 'count' ? 'count' : 'usd')

/** "Ventas, ganancia bruta y EBITDA": labels inside a sentence. */
function listed(labels: string[]): string {
  const words = labels.map((l, i) => (i === 0 || l === l.toUpperCase() ? l : l.charAt(0).toLowerCase() + l.slice(1)))
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} y ${words.at(-1)}` : words[0]
}

/** Where the rows come from, how far back, and in what money. */
function notes(t: StatementTable, s: AssetStatements): string[] {
  const since = (rows: StatementRow[]) => rows.map((r) => r.series[0].end).sort()[0].slice(0, 4)
  const [sec, tv, yahoo] = (['sec', 'tradingview', 'yahoo'] as const).map((source) => t.rows.filter((r) => r.source === source))
  const out = sec.length
    ? [
        `Fuente: SEC (EDGAR), datos oficiales desde ${since(sec)}.`,
        ...[tv, yahoo].filter((rows) => rows.length).map((rows) => `De ${SOURCE_NAMES[rows[0].source]}, desde ${since(rows)}: ${listed(rows.map((r) => r.def.label))}.`),
      ]
    : [
        tv.length === 0
          ? `Fuente: Yahoo Finance, desde ${since(yahoo)}.`
          : `${listed(tv.map((r) => r.def.label))} vienen de TradingView, desde ${since(tv)}${yahoo.length ? `; el resto, de Yahoo Finance, desde ${since(yahoo)}` : ''}.`,
      ]
  const from = [...new Set(t.rows.filter((r) => !r.def.unit).map((r) => r.currency))]
  if (from.includes('ARS')) out.push('Montos en millones de dólares CCL, al cierre de cada período.')
  else if (from.some((c) => c !== 'USD')) out.push(`Montos en millones de dólares, pasados de ${from.filter((c) => c !== 'USD').join(' y ')} al cierre de cada período.`)
  else out.push('Montos en millones de dólares.')
  if (s.sources.sec === 'error') out.push('No pudimos traer los datos oficiales de la SEC: estas filas vienen de Yahoo Finance y TradingView.')
  if (s.sources.fx === 'error') out.push('No pudimos traer el tipo de cambio: faltan los montos que había que pasar a dólares.')
  if (Object.values(s.sources).includes('stale')) out.push('Algunos datos son de la última vez que pudimos traerlos.')
  return out
}

/**
 * Balances completos (odd/tasks/asset-page.md T11, S8; the "Planilla, como un balance" mockup): Resultados,
 * Balance and Flujo de caja as tables, one row per line and one column per period, newest first. The table
 * scrolls inside its box with the line names pinned; a row opens its chart.
 */
export function Balances({ page, onBack }: { page: AssetPage; onBack: () => void }) {
  const url = `/api/asset/${encodeURIComponent(page.ticker)}/statements`
  const { data, error, reload } = useCached(`asset-statements:${url}`, () => apiData<AssetStatements>(url))
  const [statement, setStatement] = useState<StatementId>('income')
  const [mode, setMode] = useState<StatementMode>('quarterly')
  const [range, setRange] = useState<Range>('5')
  const title = useRef<HTMLHeadingElement>(null)
  const radios = useId()
  const hasSec = !!data?.sec && [data.sec.quarterly, data.sec.annual].some((lines) => Object.keys(lines).length > 0)

  // Opened from the end of a long list: the reader lands on its title, announced, without a focus ring.
  useEffect(() => title.current?.focus(), [])

  let body: React.ReactNode
  if (!data) body = error ? <LoadError message={requestErrorMessage(error, FAILED)} onRetry={reload} /> : <Loading label="Cargando balances" />
  else if (!data.yahoo && !data.tradingview) {
    const failed = Object.values(data.sources).some((s) => s === 'error')
    body = failed ? <LoadError message={FAILED} onRetry={reload} /> : <p className="py-6 text-[15px] text-ink-2">Todavía no tenemos balances de esta empresa.</p>
  } else {
    const t = tableOf(data, statement, mode, range === 'all' ? Infinity : Number(range))
    const label = STATEMENTS.find((x) => x.id === statement)!.label
    body = t.rows.length === 0 ? (
      <p className="max-w-prose py-6 text-[15px] leading-relaxed text-ink-2">
        {mode === 'annual' && data.yahoo?.currency === 'ARS'
          ? `Yahoo no tiene balances anuales comparables de empresas que informan en pesos: mezcla años en pesos de cada momento con años ajustados por inflación. Mirá Trimestral, o ${MAX_YEARS} años para los datos clave de TradingView.`
          : `No hay datos de ${label.toLowerCase()} ${mode === 'annual' ? 'anuales' : 'trimestrales'}.`}
      </p>
    ) : (
      <>
        <Table table={t} mode={mode} caption={`${label}, ${mode === 'annual' ? 'por año' : 'por trimestre'}`} />
        <div className="mt-3 grid max-w-prose gap-1 text-[15px] leading-relaxed text-ink-2">
          {notes(t, data).map((n) => <p key={n}>{n}</p>)}
        </div>
      </>
    )
  }

  return (
    <section aria-labelledby={`${radios}-title`} className="min-w-0">
      <button type="button" onClick={onBack} className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-0.5 rounded-md px-2 text-[15px] font-medium text-accent-ink hover:underline">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Números
      </button>
      <h2 ref={title} tabIndex={-1} id={`${radios}-title`} className="scroll-mt-4 text-xl font-semibold leading-tight outline-none">Balances completos de {shortName(page.name)}</h2>
      <p className="mt-1 max-w-prose text-[15px] text-ink-2">
        ▲▼ contra {mode === 'annual' ? 'el año anterior' : 'el mismo trimestre de un año antes'}. Tocá una fila para ver su gráfico
        <span className="lg:hidden">; deslizá la tabla para ver más períodos</span>.
      </p>
      {/* The shared control draws 13 px labels; here they read at 15 px (L25). */}
      <div className="my-4 flex flex-wrap gap-2 [&_label]:text-[15px]">
        <Segmented name={`${radios}-statement`} legend="Estado" value={statement} onChange={setStatement} options={STATEMENTS.map((x) => ({ value: x.id, label: x.label }))} />
        <Segmented name={`${radios}-mode`} legend="Período" value={mode} onChange={setMode} options={[...MODES]} />
        <Segmented
          name={`${radios}-range`} legend="Rango" value={range} onChange={setRange}
          options={RANGES.filter((r) => r.value !== 'all' || hasSec)}
        />
      </div>
      {body}
    </section>
  )
}

function Table({ table, mode, caption }: { table: StatementTable; mode: StatementMode; caption: string }) {
  const [chart, setChart] = useState<StatementRow | null>(null)
  // Columns newest first; a "…" after one whose next (older) column is more than a period away (L38 D5).
  const gapAfter = (i: number) => i + 1 < table.columns.length && isGap(table.columns[i + 1], table.columns[i], mode)
  return (
    <>
      {/*
        Wider than the screen, it scrolls inside this box, never the page, with the line names pinned. Relative, so the
        cells' sr-only words (absolute) stay inside it too instead of widening the page.
      */}
      <div className="relative overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="min-w-full border-collapse text-[15px]">
          <caption className="sr-only">{caption}, en millones de dólares</caption>
          <thead className="bg-surface-2 text-ink-2">
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-left align-bottom font-semibold shadow-[1px_0_0_var(--line)]">US$ millones</th>
              {table.columns.map((end, i) => {
                const [months, year] = periodLabel(end, mode).split(' ')
                const missing = gapAfter(i) && `Sin datos entre ${periodLabel(table.columns[i + 1], mode)} y ${periodLabel(end, mode)}`
                return (
                  <Fragment key={end}>
                    <th scope="col" className="whitespace-nowrap px-3 py-2 text-right align-bottom font-semibold last:pr-4">
                      {year ? <><span className="block font-normal">{months}</span> {year}</> : months}
                    </th>
                    {missing && (
                      <th scope="col" title={missing} className="border-x border-line px-1 py-2 text-center align-bottom font-normal text-ink-3">
                        <span aria-hidden="true">…</span>
                        <span className="sr-only"> {missing}</span>
                      </th>
                    )}
                  </Fragment>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr
                key={row.def.id}
                // A tap anywhere on the row opens its chart; the "?" (and its popover, a portal) only explains it.
                onClick={(e) => {
                  const target = e.target as Element
                  if (e.currentTarget.contains(target) && !target.closest('[data-help]')) setChart(row)
                }}
                className="group cursor-pointer border-t border-line hover:bg-hover"
              >
                {/*
                  The whole row is the 44 px target. A button is always an inline block, so the label is text, its last
                  word and "?" kept together as in Números, and the button an empty layer over the cell for the keyboard.
                */}
                {/* On desktop the names keep room for a line each ("Costo de ventas") however many columns there are. */}
                <th scope="row" className="sticky left-0 z-10 h-11 min-w-[8.5rem] max-w-[11rem] bg-surface px-3 py-2 text-left align-middle font-medium leading-snug shadow-[1px_0_0_var(--line)] group-hover:bg-hover sm:max-w-[16rem] lg:min-w-[14rem]">
                  <button type="button" aria-label={`${row.def.label}: ver su gráfico`} className="absolute inset-0 cursor-pointer focus-visible:outline-offset-[-2px]" />
                  {row.def.label.slice(0, row.def.label.lastIndexOf(' ') + 1)}
                  <span className="whitespace-nowrap">
                    {row.def.label.slice(row.def.label.lastIndexOf(' ') + 1)}
                    <Help label={row.def.label} help={row.def.help} />
                  </span>
                  {row.since && <span className="block text-sm font-normal text-ink-2">desde {row.since}</span>}
                </th>
                {table.columns.map((end, i) => (
                  <Fragment key={end}>
                    <Cell row={row} end={end} mode={mode} />
                    {gapAfter(i) && <td aria-hidden="true" className="border-x border-line" />}
                  </Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={chart !== null} onOpenChange={(open) => { if (!open) setChart(null) }}>
        {chart && <RowChart row={chart} mode={mode} />}
      </Dialog>
    </>
  )
}

/** The row's "?": 18 px drawn, 44 px to tap, as in Números. */
function Help({ label, help }: { label: string; help: string }) {
  return (
    <Popover>
      <PopoverTrigger
        data-help
        aria-label={`Qué es ${label}`}
        className="relative z-10 ml-1.5 inline-grid h-[18px] w-[18px] place-items-center rounded-full align-[1px] bg-surface-2 font-mono text-[11px] font-semibold leading-none text-ink-2 before:absolute before:-inset-[13px] before:content-[''] hover:bg-hover hover:text-ink data-[popup-open]:bg-ink data-[popup-open]:text-canvas"
      >
        ?
      </PopoverTrigger>
      <PopoverContent data-help className="max-w-[min(22rem,calc(100vw-2rem))] p-3 text-[15px] leading-normal">
        <b>¿Qué es?</b> {help}
      </PopoverContent>
    </Popover>
  )
}

/** One period's value with ▲▼ against the same period a year earlier; "—" for a gap, blank before the row starts. */
function Cell({ row, end, mode }: { row: StatementRow; end: string; mode: StatementMode }) {
  const p = row.series.find((q) => columnOf(q.end, mode) === columnOf(end, mode))
  if (!p) return <td className="px-3 py-2 text-right font-mono text-ink-3 last:pr-4">{end > row.series[0].end ? '—' : ''}</td>
  const t = trend(row.series, p.end)
  return (
    <td className={cn('whitespace-nowrap px-3 py-2 text-right font-mono last:pr-4', p.value < 0 && 'text-danger')}>
      {cellText(p.value, row)}
      <span aria-hidden="true" className={cn('ml-1 inline-block w-3 text-left text-[13px]', t > 0 ? 'text-ok' : 'text-danger')}>
        {t > 0 ? '▲' : t < 0 ? '▼' : ''}
      </span>
      {t !== 0 && <span className="sr-only">{t > 0 ? ' (sube)' : ' (baja)'}</span>}
    </td>
  )
}

/** A row's history: its last value and change in a year, the chart, and what it is. */
function RowChart({ row, mode }: { row: StatementRow; mode: StatementMode }) {
  const last = row.series[row.series.length - 1]
  const change = changeVsYearAgo(row.series, 'usd')
  const unit = chartUnit(row)
  return (
    <StrategyDialog title={row.def.label} width={640}>
      <div className="grid gap-4 p-5">
        <div>
          <p className="text-[15px] text-ink-2">
            {periodLabel(last.end, mode)} · {SOURCE_NAMES[row.source]}
          </p>
          <p className={cn('font-mono text-2xl font-semibold leading-tight', last.value < 0 && 'text-danger')}>
            {formatMetric(last.value, unit === 'usdPerShare' ? 'price' : unit)}
          </p>
          {change !== null && (
            <p className={cn('mt-0.5 font-mono text-[15px] font-medium', change < 0 ? 'text-danger' : change > 0 ? 'text-ok' : 'text-ink-2')}>
              {change < 0 ? '▼ ' : change > 0 ? '▲ ' : ''}
              {formatNumber(Math.abs(change), { decimals: 1 })} % contra un año antes
            </p>
          )}
        </div>
        <LineChart series={row.series} unit={unit} better="higher" mode={mode} today={null} label={row.def.label} />
        {row.since && <p className="text-[15px] text-ink-2">Historia desde {row.since}.</p>}
        <p className="max-w-prose text-[15px] leading-relaxed text-ink-2">
          <b className="text-ink">¿Qué es?</b> {row.def.help}
        </p>
      </div>
    </StrategyDialog>
  )
}
