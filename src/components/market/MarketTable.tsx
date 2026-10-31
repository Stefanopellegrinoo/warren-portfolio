'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, FileText, LineChart } from 'lucide-react'
import { cn, formatPct } from '@/lib/utils'
import { Chip, toneOf } from '@/components/resumen/ui'
import { priceText } from '@/components/trading/ui'
import { assetHref } from '@/components/shell/nav'
import { CURRENCIES } from '@/lib/resumen/currency'
import type { Currency } from '@/lib/multicurrency'
import { inCurrency, type Sort, type SortKey, type ViewRow } from '@/lib/market-view'
import { field, HEAD_ROW, label as labelCls, ScrollTable, TD as TD_BASE, TH as TH_BASE } from '@/components/ons/ui'

interface Props {
  rows: ViewRow[]
  sort: Sort
  onSort: (key: SortKey, dir?: 'asc' | 'desc') => void
  currency: Currency
  fx: { mep: number | null; ccl: number | null }
  /** The list control of a row (odd/tasks/market-page.md T5). */
  star: (row: ViewRow) => ReactNode
  empty: string
}

const chartHref = (r: ViewRow) => `/trading?symbol=${encodeURIComponent(r.stored)}`
const LINK = 'inline-flex items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-ink-2 hover:bg-hover hover:text-ink'

function Price({ r, currency, fx }: Pick<Props, 'currency' | 'fx'> & { r: ViewRow }) {
  const v = inCurrency(r.price, currency, fx)
  if (v === null) return <span className="text-ink-3">Sin precio</span>
  return <>{CURRENCIES.find((c) => c.id === currency)!.prefix} {priceText(v)}</>
}

const Change = ({ r }: { r: ViewRow }) =>
  r.changePct === null ? <span className="text-ink-3">—</span> : <Chip tone={toneOf(r.changePct)}>{formatPct(r.changePct)}</Chip>

function Actions({ r, star, className }: { r: ViewRow; star: Props['star']; className?: string }) {
  return (
    <span className={cn('flex items-center justify-end gap-1', className)}>
      <Link href={chartHref(r)} className={cn(LINK, 'min-h-8 max-[1079px]:min-h-11')}>
        <LineChart className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />Gráfico<span className="sr-only"> de {r.ticker}</span>
      </Link>
      <Link href={assetHref(r.stored)} className={cn(LINK, 'min-h-8 max-[1079px]:min-h-11')}>
        <FileText className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />Ficha<span className="sr-only"> de {r.ticker}</span>
      </Link>
      {star(r)}
    </span>
  )
}

const SORT_OPTIONS: [string, string][] = [
  ['change:desc', 'Var. día, mayor primero'], ['change:asc', 'Var. día, menor primero'],
  ['price:desc', 'Precio, mayor primero'], ['price:asc', 'Precio, menor primero'],
  ['ticker:asc', 'Ticker, A a Z'], ['ticker:desc', 'Ticker, Z a A'],
]

/** Phones and tablets: the order in words, since there is no table header to show it. */
export function MarketSortSelect({ sort, onSort, className }: Pick<Props, 'sort' | 'onSort'> & { className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <label htmlFor="market-sort" className={cn(labelCls, 'flex-none')}>Ordenar por</label>
      <select id="market-sort" className={cn(field, 'min-w-0 flex-1')} value={`${sort.key}:${sort.dir}`}
        onChange={(e) => { const [key, dir] = e.target.value.split(':'); onSort(key as SortKey, dir as 'asc' | 'desc') }}>
        {SORT_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
    </div>
  )
}

const TH = cn(TH_BASE, 'pr-6 align-bottom')
const TD = cn(TD_BASE, 'pr-6 align-middle')

function Head({ k, label, sort, onSort, className }: { k: SortKey; label: string; sort: Sort; onSort: Props['onSort']; className?: string }) {
  const active = sort.key === k
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn(TH, className)}>
      <button type="button" onClick={() => onSort(k)} className={cn('inline-flex min-h-8 items-center gap-1 hover:text-ink', active && 'text-ink')}>
        {label}
        {active && (sort.dir === 'asc' ? <ArrowUp aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} /> : <ArrowDown aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />)}
      </button>
    </th>
  )
}

/** Below 1080 px: one compact row per asset; tapping it opens Gráfico, Ficha and the list control. */
function PhoneList({ rows, currency, fx, star, empty }: Omit<Props, 'sort' | 'onSort'>) {
  const [open, setOpen] = useState<string | null>(null)
  if (rows.length === 0) return <p className="py-10 text-center text-ink-3 min-[1080px]:hidden">{empty}</p>
  return (
    <ul aria-label="Activos" className="border-t border-line-strong min-[1080px]:hidden">
      {rows.map((r) => {
        const expanded = open === r.key
        return (
          <li key={r.key} className="border-b border-line last:border-b-0">
            <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.key)}
              className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2 text-left">
              <span className="min-w-0">
                <span className="block font-semibold text-ink">{r.ticker}</span>
                <span className="block truncate text-[13px] text-ink-3">{r.note ?? r.name ?? '—'}</span>
              </span>
              {r.note ? <span /> : (
                <span className="flex flex-col items-end gap-1 tabular-nums">
                  <span className="text-ink"><Price r={r} currency={currency} fx={fx} /></span>
                  <Change r={r} />
                </span>
              )}
            </button>
            {expanded && <Actions r={r} star={star} className="justify-start pb-2" />}
          </li>
        )
      })}
    </ul>
  )
}

export default function MarketTable(props: Props) {
  const { rows, sort, onSort, currency, fx, star, empty } = props
  return (
    <>
      <div className="max-[1079px]:hidden">
        <ScrollTable label="Tabla de activos">
          <table className="w-full border-collapse text-sm tabular-nums">
            <caption className="sr-only">Activos de la lista elegida. Ordená por columna con el encabezado.</caption>
            <thead>
              <tr className={cn(HEAD_ROW, 'text-left')}>
                <Head k="ticker" label="Ticker" sort={sort} onSort={onSort} />
                <Head k="price" label="Precio" sort={sort} onSort={onSort} className="text-right" />
                <Head k="change" label="Var. día" sort={sort} onSort={onSort} className="text-right" />
                <th scope="col" className={cn(TH, 'text-right')}><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-10 text-center text-ink-3">{empty}</td></tr>
              ) : rows.map((r) => (
                <tr key={r.key} className="border-b border-line last:border-b-0 hover:bg-hover">
                  <th scope="row" className={cn(TD, 'w-full max-w-0 text-left font-normal')}>
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="font-semibold text-ink">{r.ticker}</span>
                      {r.name && <span className="truncate text-[13px] text-ink-3">{r.name}</span>}
                    </span>
                  </th>
                  {r.note
                    ? <td colSpan={2} className={cn(TD, 'text-right text-[13px] text-ink-3')}>{r.note}</td>
                    : <>
                      <td className={cn(TD, 'text-right')}><Price r={r} currency={currency} fx={fx} /></td>
                      <td className={cn(TD, 'text-right')}><Change r={r} /></td>
                    </>}
                  <td className={cn(TD, 'text-right')}><Actions r={r} star={star} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      </div>
      <PhoneList rows={rows} currency={currency} fx={fx} star={star} empty={empty} />
    </>
  )
}
