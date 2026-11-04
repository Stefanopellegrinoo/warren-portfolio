'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, LineChart } from 'lucide-react'
import { cn, formatNumber, formatPct } from '@/lib/utils'
import { Chip, toneOf } from '@/components/resumen/ui'
import { priceText } from '@/components/trading/ui'
import { assetHref } from '@/components/shell/nav'
import { CURRENCIES } from '@/lib/resumen/currency'
import type { Currency } from '@/lib/multicurrency'
import { dayChange, inCurrency, type Sort, type SortKey, type ViewRow } from '@/lib/market-view'

interface Props {
  rows: ViewRow[]
  sort: Sort
  onSort: (key: SortKey) => void
  currency: Currency
  fx: { mep: number | null; ccl: number | null }
  /** The list control of a row (odd/tasks/market-page.md S4); `label` adds its word on phones. */
  star: (row: ViewRow, label?: boolean) => ReactNode
  empty: string
}

const chartHref = (r: ViewRow) => `/trading?symbol=${encodeURIComponent(r.stored)}`
const prefixOf = (c: Currency) => CURRENCIES.find((x) => x.id === c)!.prefix

function Price({ r, currency, fx }: Pick<Props, 'currency' | 'fx'> & { r: ViewRow }) {
  const v = inCurrency(r.price, currency, fx)
  return v === null ? <span className="font-sans text-ink-3">Sin precio</span> : <>{prefixOf(currency)} {priceText(v)}</>
}

const Change = ({ r }: { r: ViewRow }) =>
  r.changePct === null ? <span className="text-ink-3">—</span> : <Chip tone={toneOf(r.changePct)}>{formatPct(r.changePct)}</Chip>

/** S12: today's change in money, in the chosen currency. */
function Money({ r, currency, fx }: Pick<Props, 'currency' | 'fx'> & { r: ViewRow }) {
  const v = inCurrency(dayChange(r), currency, fx)
  if (v === null) return <span className="text-ink-3">—</span>
  const tone = v > 0 ? 'text-ok' : v < 0 ? 'text-danger' : 'text-ink-3'
  return <span className={tone}>{formatNumber(v, { sign: v !== 0 })}</span>
}

const ICON = 'inline-grid h-8 w-8 place-items-center rounded-md text-ink-3 hover:bg-hover hover:text-ink'

function IconLinks({ r }: { r: ViewRow }) {
  return (
    <span className="flex items-center justify-end gap-0.5">
      <Link href={chartHref(r)} aria-label={`Gráfico de ${r.ticker}`} title="Gráfico" className={ICON}>
        <LineChart className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
      </Link>
      <Link href={assetHref(r.stored)} aria-label={`Ficha de ${r.ticker}`} title="Ficha" className={ICON}>
        <FileText className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
      </Link>
    </span>
  )
}

function SortButton({ k, label, sort, onSort, className }: { k: SortKey; label: string; sort: Sort; onSort: Props['onSort']; className?: string }) {
  const active = sort.key === k
  const Arrow = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <button type="button" onClick={() => onSort(k)} className={cn('inline-flex items-center gap-1 hover:text-ink', active && 'text-ink', className)}>
      {label}
      <Arrow aria-hidden className={cn('h-3.5 w-3.5', !active && 'opacity-50')} strokeWidth={1.5} />
    </button>
  )
}

const ariaSort = (sort: Sort, k: SortKey) => (sort.key !== k ? 'none' : sort.dir === 'asc' ? 'ascending' : 'descending')
const TH = 'h-9 whitespace-nowrap px-3 text-xs font-medium text-ink-3'
const TD = 'h-11 whitespace-nowrap px-3'

/** Below 960 px: a header that sorts, one compact row per asset; tapping a row opens Gráfico, Ficha and its lists. */
function PhoneList({ rows, sort, onSort, currency, fx, star, empty }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="min-[960px]:hidden">
      <div role="group" aria-label="Ordenar la lista" className="flex items-center justify-between border-b border-line bg-surface-2 px-3 text-xs font-medium text-ink-3">
        <SortButton k="ticker" label="Nombre" sort={sort} onSort={onSort} className="min-h-11" />
        <SortButton k="change" label="Var. día" sort={sort} onSort={onSort} className="min-h-11" />
      </div>
      {rows.length === 0 ? <p className="px-3 py-10 text-center text-ink-3">{empty}</p> : (
        <ul aria-label="Activos">
          {rows.map((r) => {
            const expanded = open === r.key
            return (
              <li key={r.key} className="border-b border-line last:border-b-0">
                <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.key)}
                  className="grid min-h-[58px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2 text-left">
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">{r.ticker}</span>
                    <span className="block truncate text-[12.5px] text-ink-3">{r.note ?? r.name ?? '—'}</span>
                  </span>
                  {r.note ? <span /> : (
                    <span className="grid justify-items-end gap-1 tabular-nums">
                      <span className="font-mono text-[13.5px] text-ink"><Price r={r} currency={currency} fx={fx} /></span>
                      <Change r={r} />
                    </span>
                  )}
                </button>
                {expanded && (
                  <div className="flex gap-1.5 bg-hover px-3 pb-2.5 pt-1">
                    <Link href={chartHref(r)} className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md border border-line bg-surface text-[13px] text-ink">
                      <LineChart className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />Gráfico<span className="sr-only"> de {r.ticker}</span>
                    </Link>
                    <Link href={assetHref(r.stored)} className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md border border-line bg-surface text-[13px] text-ink">
                      <FileText className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />Ficha<span className="sr-only"> de {r.ticker}</span>
                    </Link>
                    <span className="flex flex-1 [&>*]:w-full">{star(r, true)}</span>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default function MarketTable(props: Props) {
  const { rows, sort, onSort, currency, fx, star, empty } = props
  return (
    <>
      <div className="overflow-x-auto max-[959px]:hidden">
        <table className="w-full border-collapse text-sm tabular-nums">
          <caption className="sr-only">Activos de la lista elegida. Ordená por columna con el encabezado.</caption>
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left">
              <th scope="col" className={cn(TH, 'w-11 pr-0')}><span className="sr-only">Listas</span></th>
              <th scope="col" aria-sort={ariaSort(sort, 'ticker')} className={TH}><SortButton k="ticker" label="Nombre" sort={sort} onSort={onSort} className="min-h-8" /></th>
              <th scope="col" aria-sort={ariaSort(sort, 'price')} className={cn(TH, 'text-right')}><SortButton k="price" label="Precio" sort={sort} onSort={onSort} className="min-h-8" /></th>
              <th scope="col" aria-sort={ariaSort(sort, 'change')} className={cn(TH, 'text-right')}><SortButton k="change" label="Var. día" sort={sort} onSort={onSort} className="min-h-8" /></th>
              <th scope="col" aria-sort={ariaSort(sort, 'abs')} className={cn(TH, 'text-right')}><SortButton k="abs" label="Var. $" sort={sort} onSort={onSort} className="min-h-8" /></th>
              <th scope="col" className={cn(TH, 'w-24')}><span className="sr-only">Gráfico y ficha</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-12 text-center text-ink-3">{empty}</td></tr>
            ) : rows.map((r) => (
              <tr key={r.key} className="border-b border-line last:border-b-0 hover:bg-hover">
                <td className={cn(TD, 'pr-0')}>{star(r)}</td>
                <th scope="row" className={cn(TD, 'w-full max-w-0 text-left font-normal')}>
                  <span className="flex min-w-0 items-baseline gap-2.5">
                    <span className="font-semibold text-ink">{r.ticker}</span>
                    {r.name && <span className="truncate text-[12.5px] text-ink-3">{r.name}</span>}
                  </span>
                </th>
                {r.note
                  ? <td colSpan={3} className={cn(TD, 'text-right text-[13px] text-ink-3')}>{r.note}</td>
                  : <>
                    <td className={cn(TD, 'text-right font-mono text-[13.5px]')}><Price r={r} currency={currency} fx={fx} /></td>
                    <td className={cn(TD, 'text-right')}><Change r={r} /></td>
                    <td className={cn(TD, 'text-right font-mono text-[13.5px]')}><Money r={r} currency={currency} fx={fx} /></td>
                  </>}
                <td className={cn(TD, 'pl-0')}><IconLinks r={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PhoneList {...props} />
    </>
  )
}
