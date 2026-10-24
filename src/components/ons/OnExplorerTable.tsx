import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OnListRow } from '@/lib/on-analytics'
import type { ExplorerState, SortKey } from '@/lib/on-explorer-filters'
import { eventLabel, fmtBp, fmtDate, fmtNum, fmtPct, fmtUsdCompact, safeHref } from '@/lib/on-format'
import { field, HEAD_ROW, label as labelCls, ScrollTable, TH as TH_BASE, TD as TD_BASE, tag } from './ui'

type Sort = ExplorerState['sort']

interface Props {
  rows: OnListRow[]
  sort: Sort
  onSort: (key: SortKey) => void
  /** Desktop: also show duration, parity, current yield, average life and spread ("Más columnas"). */
  moreColumns?: boolean
}

// odd/tasks/ux-ons-y-operaciones.md S4: by default the columns a retail investor chooses by;
// the technical ones appear with "Más columnas". `text` is the value as the phone card shows it.
interface Column {
  key: SortKey | 'nextPay'
  head: string
  numeric: boolean
  extra?: boolean
  text: (r: OnListRow) => string
}

const priceText = (r: OnListRow) => (r.price === null ? 'Sin precio' : fmtNum(r.price))
// A row without trades in the session shows no TIR in the list; the value stays on the detail page.
const tirText = (r: OnListRow) => (r.priceQuality === 'no-trades' ? '—' : fmtPct(r.ytmPct))

const COLUMNS: Column[] = [
  { key: 'maturity', head: 'Vence', numeric: false, text: (r) => fmtDate(r.maturityDate) },
  { key: 'price', head: 'Precio', numeric: true, text: priceText },
  { key: 'ytm', head: 'TIR', numeric: true, text: tirText },
  { key: 'nextPay', head: 'Próximo pago', numeric: false, text: (r) => fmtDate(r.nextPayDate) },
  { key: 'adtv', head: 'Volumen', numeric: true, text: (r) => fmtUsdCompact(r.adtvUsd) },
  { key: 'md', head: 'Duración', numeric: true, extra: true, text: (r) => fmtNum(r.mdYears) },
  { key: 'paridad', head: 'Paridad', numeric: true, extra: true, text: (r) => fmtPct(r.paridadPct) },
  { key: 'cy', head: 'Tasa corriente', numeric: true, extra: true, text: (r) => fmtPct(r.currentYieldPct) },
  { key: 'wal', head: 'Vida promedio', numeric: true, extra: true, text: (r) => fmtNum(r.walYears) },
  { key: 'spread', head: 'Spread', numeric: true, extra: true, text: (r) => fmtBp(r.spreadBp) },
]

// The phone sort options, most used first; every key in both directions, said in words.
const SORT_NAMES: [SortKey, string][] = [
  ['adtv', 'Volumen'], ['ytm', 'TIR'], ['maturity', 'Vencimiento'], ['price', 'Precio'], ['md', 'Duración'],
  ['paridad', 'Paridad'], ['cy', 'Tasa corriente'], ['wal', 'Vida promedio'], ['spread', 'Spread'], ['ticker', 'Ticker'],
]
const dirWords = (key: SortKey, dir: 'asc' | 'desc') =>
  key === 'ticker' ? (dir === 'asc' ? 'A a Z' : 'Z a A')
    : key === 'maturity' ? (dir === 'asc' ? 'más cercano primero' : 'más lejano primero')
      : dir === 'desc' ? 'mayor primero' : 'menor primero'

/** Phones and tablets: the list's order in words ("Volumen, mayor primero"), since there is no table header to show it. */
export function SortSelect({ sort, onSort, className }: { sort: Sort; onSort: (key: SortKey, dir: 'asc' | 'desc') => void; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2 max-[400px]:flex-col max-[400px]:items-stretch max-[400px]:gap-1', className)}>
      <label htmlFor="on-sort" className={cn(labelCls, 'flex-none')}>Ordenar por</label>
      <select id="on-sort" className={cn(field, 'min-w-0 flex-1')} value={`${sort.key}:${sort.dir}`}
        onChange={(e) => { const [key, dir] = e.target.value.split(':'); onSort(key as SortKey, dir as 'asc' | 'desc') }}>
        {SORT_NAMES.flatMap(([key, name]) => {
          const dirs: ('asc' | 'desc')[] = key === 'ticker' || key === 'maturity' ? ['asc', 'desc'] : ['desc', 'asc']
          return dirs.map((dir) => <option key={`${key}:${dir}`} value={`${key}:${dir}`}>{name}, {dirWords(key, dir)}</option>)
        })}
      </select>
    </div>
  )
}

/**
 * S6: what used to be ⚠ / ⓘ / "<90 d" with the reason in a tooltip is now one short visible note
 * under the TIR; the full reason is on the detail page.
 */
function tirNote(r: OnListRow): { text: string; warn?: boolean } | null {
  if (r.status === 'no-price') return null // the price already says "Sin precio"
  if (r.priceQuality === 'no-trades') return { text: 'sin operaciones en la rueda', warn: true }
  if (r.rateType === 'floating') return { text: 'tasa variable' }
  if (r.methodFlag) return { text: 'difiere de BYMA', warn: true }
  if (r.shortDated && r.ytmPct !== null) return { text: 'vence en menos de 90 días' }
  return null
}

function Tir({ r, className }: { r: OnListRow; className?: string }) {
  const note = tirNote(r)
  return (
    <span className={cn('flex flex-col items-end', className)}>
      <span className="font-semibold">{tirText(r)}</span>
      {note && <span className={cn('whitespace-nowrap text-xs', note.warn ? 'text-warn' : 'text-ink-3')}>{note.text}</span>}
    </span>
  )
}

/** At most one tag per ON: its first corporate event, linked to the source when there is one. */
function EventTag({ r }: { r: OnListRow }) {
  const e = r.events[0]
  if (!e) return null
  const href = safeHref(e.sourceUrl)
  const text = `${eventLabel(e.kind)} ${fmtDate(e.eventDate)}`
  const cls = cn(tag('info'), 'relative z-10')
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer" className={cn(cls, 'underline-offset-2 hover:underline')}>{text}<span className="sr-only"> (fuente, abre en otra pestaña)</span></a>
    : <span className={cls}>{text}</span>
}

function Issuer({ r }: { r: OnListRow }) {
  return (
    <span className="flex min-w-0 gap-1 text-[13px]">
      <span className="truncate text-ink-2">{r.issuer ?? '—'}</span>
      <span className="flex-none text-ink-3">· {r.currencyLabel}</span>
    </span>
  )
}

const ON_LINK = 'font-semibold text-ink hover:text-accent-ink hover:underline hover:underline-offset-2'
const VISIBLE_ON_CARD: (SortKey | 'nextPay')[] = ['ticker', 'maturity', 'price', 'ytm', 'nextPay']

/** Below 1080 px (phones and tablets, where the menu takes room): one card per ON; the whole card opens the detail. */
function PhoneList({ rows, sort }: Pick<Props, 'rows' | 'sort'>) {
  const sortCol = VISIBLE_ON_CARD.includes(sort.key) ? null : COLUMNS.find((c) => c.key === sort.key)
  if (rows.length === 0) return <p className="py-10 text-center text-ink-3 min-[1080px]:hidden">Sin resultados. Probá con otra búsqueda o con menos filtros.</p>
  return (
    <ul aria-label="Obligaciones negociables" className="border-t border-line-strong min-[1080px]:hidden">
      {rows.map((r) => (
        <li key={r.isin} className="relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-line py-3 last:border-b-0">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link href={`/ons/${r.isin}`} className={cn(ON_LINK, 'text-base before:absolute before:inset-0')}>{r.tickerO}</Link>
              <EventTag r={r} />
            </div>
            <Issuer r={r} />
          </div>
          <div className="text-right">
            <span className="sr-only">TIR </span>
            <Tir r={r} className="text-base tabular-nums" />
          </div>
          <p className="col-span-2 mt-1.5 text-[13px] tabular-nums text-ink-2">
            Vence {fmtDate(r.maturityDate)} · {r.price === null ? 'Sin precio' : `Precio ${fmtNum(r.price)}`}
          </p>
          <p className="col-span-2 text-[13px] tabular-nums text-ink-3">
            <span className="whitespace-nowrap">Próximo pago {fmtDate(r.nextPayDate)}</span>
            {sortCol && <> · <span className="whitespace-nowrap text-ink-2">{sortCol.head} {sortCol.text(r)}</span></>}
          </p>
        </li>
      ))}
    </ul>
  )
}

const TH = cn(TH_BASE, 'pr-6 align-bottom')
const TD = cn(TD_BASE, 'pr-6 align-top')
// With "Más columnas" the table can scroll sideways: the first column stays in view and repaints the row hover.
const STICKY = 'sticky left-0 z-10 bg-canvas group-hover:bg-hover'

function sortAria(active: boolean, dir: 'asc' | 'desc'): 'ascending' | 'descending' | 'none' {
  return active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'
}

function Head({ k, label, sort, onSort, className }: { k: SortKey | 'nextPay'; label: string; sort: Sort; onSort: Props['onSort']; className?: string }) {
  if (k === 'nextPay') return <th scope="col" className={cn(TH, className)}><span className="inline-flex min-h-8 items-center">{label}</span></th>
  const active = sort.key === k
  return (
    <th scope="col" aria-sort={sortAria(active, sort.dir)} className={cn(TH, className)}>
      <button type="button" onClick={() => onSort(k)} className={cn('inline-flex min-h-8 items-center gap-1 hover:text-ink', active && 'text-ink')}>
        {label}
        {active && (sort.dir === 'asc' ? <ArrowUp aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} /> : <ArrowDown aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />)}
      </button>
    </th>
  )
}

function cell(c: Column, r: OnListRow): ReactNode {
  if (c.key === 'ytm') return <Tir r={r} />
  if (c.key === 'price') return <span className={r.price === null || r.priceQuality === 'no-trades' ? 'text-ink-3' : undefined}>{priceText(r)}</span>
  return c.text(r)
}

export default function OnExplorerTable({ rows, sort, onSort, moreColumns = false }: Props) {
  const cols = COLUMNS.filter((c) => moreColumns || !c.extra)
  return (
    <>
      <div className="relative max-[1079px]:hidden">
        <ScrollTable label="Tabla de ONs">
          <table className="w-full border-collapse text-sm tabular-nums">
            <caption className="sr-only">Obligaciones negociables. Ordená por columna con el encabezado.</caption>
            <thead>
              <tr className={cn(HEAD_ROW, 'text-left')}>
                <Head k="ticker" label="ON" sort={sort} onSort={onSort} className={cn(moreColumns && 'sticky left-0 z-10 bg-canvas')} />
                {cols.map((c) => <Head key={c.key} k={c.key} label={c.head} sort={sort} onSort={onSort} className={cn(c.numeric && 'text-right')} />)}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={cols.length + 1} className="px-3 py-10 text-center text-ink-3">Sin resultados. Probá con otra búsqueda o con menos filtros.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.isin} className="group border-b border-line last:border-b-0 hover:bg-hover">
                  <th scope="row" className={cn(TD, 'w-full min-w-[10rem] max-w-0 text-left font-normal', moreColumns && cn(STICKY, 'w-auto max-w-[16rem]'))}>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link href={`/ons/${r.isin}`} className={ON_LINK}>{r.tickerO}</Link>
                      <EventTag r={r} />
                    </span>
                    <Issuer r={r} />
                  </th>
                  {cols.map((c) => <td key={c.key} className={cn(TD, c.numeric && 'text-right')}>{cell(c, r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
        {/* Right-edge fade while the wide table is wider than its box: it scrolls sideways. */}
        {moreColumns && <div data-scroll-hint aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-canvas to-transparent min-[1344px]:hidden" />}
      </div>
      <PhoneList rows={rows} sort={sort} />
    </>
  )
}
