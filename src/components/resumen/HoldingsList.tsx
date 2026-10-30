import Link from 'next/link'
import { ArrowUpDown } from 'lucide-react'
import { groupRows, nextSort, sortRows, type HoldingRow, type Sort, type SortKey } from '@/lib/resumen/holdings'
import { formatNumber, formatPct } from '@/lib/utils'
import { assetHref } from '@/components/shell/nav'
import { Chip, GroupHead, linkButton, toneOf } from './ui'

// Narrow: ticker | name over day chip | value over result.
// Wide (the list's own width, see cq-wide): one aligned column per figure, like a table.
const COLS = 'cq-wide:grid-cols-[64px_minmax(0,1fr)_104px_120px_160px_64px]'
const rowGrid =
  `grid min-h-14 grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-line py-2.5 last:border-b-0 cq-wide:gap-y-0 ${COLS}`
const valueCell = 'col-start-3 row-start-1 text-right tabular-nums cq-wide:col-start-4'
const resultCell = 'col-start-3 row-start-2 text-right text-[13px] tabular-nums cq-wide:col-start-5 cq-wide:row-start-1 cq-wide:text-sm'
const weightCell = 'hidden text-right text-[13px] tabular-nums text-ink-2 cq-wide:col-start-6 cq-wide:row-start-1 cq-wide:block'

const SORTABLE: { key: SortKey; label: string }[] = [
  { key: 'ticker', label: 'Activo' },
  { key: 'dayChangePct', label: 'Hoy' },
  { key: 'value', label: 'Valor' },
  { key: 'pnl', label: 'Resultado' },
  { key: 'weightPct', label: 'Peso' },
]

/** Wide: the column heads, aligned over their figures. Narrow: a row of sort buttons. */
function SortBar({ sort, onSort }: { sort: Sort; onSort: (sort: Sort) => void }) {
  return (
    <div role="group" aria-label="Ordenar tenencias" className={`flex flex-wrap items-center gap-1.5 pt-3 text-xs text-ink-3 cq-wide:grid cq-wide:gap-x-3 cq-wide:border-b cq-wide:border-line cq-wide:pb-2 cq-wide:pt-4 ${COLS}`}>
      <ArrowUpDown className="h-4 w-4 cq-wide:hidden" strokeWidth={1.5} aria-hidden="true" />
      {SORTABLE.map((c, i) => {
        const active = sort.key === c.key
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={active}
            onClick={() => onSort(nextSort(sort, c.key))}
            className={`inline-flex min-h-11 items-center gap-1 rounded-md border px-2 hover:text-ink cq-wide:min-h-6 cq-wide:border-0 cq-wide:px-0 ${i === 0 ? 'cq-wide:col-span-2 cq-wide:justify-self-start' : 'cq-wide:justify-self-end'} ${active ? 'border-line-strong font-medium text-ink' : 'border-line'}`}
          >
            {c.label}
            {active && <span aria-hidden="true">{sort.dir === 'asc' ? '↑' : '↓'}</span>}
            {active && <span className="sr-only">{sort.dir === 'asc' ? ', de menor a mayor' : ', de mayor a menor'}</span>}
          </button>
        )
      })}
    </div>
  )
}

function Holding({ r }: { r: HoldingRow }) {
  const weight = `${formatNumber(r.weightPct, { decimals: 1 })} % de la cartera`
  // Without a company name the quantity becomes the main line, so the ticker is not repeated.
  const title = r.name ?? r.quantityLabel
  const meta = r.name
    ? (r.value === null ? r.quantityLabel : `${r.quantityLabel}, ${weight}`)
    : (r.value === null ? 'Sin cotización' : weight)
  // The wide row has its own weight column.
  const wideMeta = r.name ? r.quantityLabel : (r.value === null ? 'Sin cotización' : null)
  return (
    <li className={rowGrid}>
      <span className="row-span-2 flex flex-col items-start self-start pt-0.5 cq-wide:row-span-1 cq-wide:self-center cq-wide:pt-0">
        <Link href={r.href} className="font-semibold text-ink hover:text-accent-ink" aria-label={`${r.ticker}${r.name ? `, ${r.name}` : ''}, ver detalle`}>
          {r.ticker}
        </Link>
        {/* The asset page (odd/tasks/asset-page.md S1); ONs already open their own. */}
        {r.kind !== 'on' && (
          <Link href={assetHref(r.ticker)} aria-label={`Ficha de ${r.ticker}`} className="inline-flex min-h-6 items-center text-xs text-accent-ink hover:underline hover:underline-offset-2">
            Ficha
          </Link>
        )}
      </span>
      <span className="col-start-2 row-start-1 min-w-0">
        <span className="block truncate font-medium">{title}</span>
        <span className="block text-[13px] text-ink-3 cq-wide:hidden">{meta}</span>
        {wideMeta && <span className="hidden truncate text-[13px] text-ink-3 cq-wide:block">{wideMeta}</span>}
      </span>
      {r.dayChangePct === null
        ? <Chip tone="neutral" className="col-start-2 row-start-2 justify-self-start cq-wide:col-start-3 cq-wide:row-start-1 cq-wide:justify-self-end">Sin precio</Chip>
        : <Chip tone={toneOf(r.dayChangePct)} className="col-start-2 row-start-2 justify-self-start cq-wide:col-start-3 cq-wide:row-start-1 cq-wide:justify-self-end">{formatPct(r.dayChangePct, { digits: 1 })}<span className="sr-only"> hoy</span></Chip>}
      <span className={valueCell}>
        <b className="block font-semibold">{r.value === null ? '—' : formatNumber(r.value)}</b>
        {r.estimated && r.value !== null && <small className="block text-[13px] text-ink-3">estimado</small>}
      </span>
      {r.pnl !== null && (
        <span className={`${resultCell} ${r.pnl >= 0 ? 'text-ok' : 'text-danger'}`}>
          {/* Each part stays whole: peso amounts are long and used to break "%)" onto its own line. */}
          <span className="whitespace-nowrap">{formatNumber(r.pnl, { decimals: 0, sign: true })}</span>{' '}
          <span className="whitespace-nowrap">({formatPct(r.pnlPct, { digits: 1 })})</span>
        </span>
      )}
      <span className={weightCell}>{formatNumber(r.weightPct, { decimals: 1 })} %</span>
    </li>
  )
}

export default function HoldingsList({ rows, cash, cashWeightPct, cashNote, onAdjustCash, sort, onSort }: {
  rows: HoldingRow[]
  sort: Sort
  onSort: (sort: Sort) => void
  cash: number
  cashWeightPct: number
  /** Why the balance reads as it does in the chosen currency. */
  cashNote?: string
  onAdjustCash: () => void
}) {
  const [stocks, cedears, ons] = groupRows(sortRows(rows, sort))
  return (
    <div className="[container-type:inline-size]">
      <SortBar sort={sort} onSort={onSort} />
      {[stocks, cedears].filter(g => g.items.length > 0).map(g => (
        <section key={g.kind} aria-label={g.title}>
          <GroupHead>{g.title} <span className="tabular-nums">{g.items.length}</span></GroupHead>
          <ul>{g.items.map(r => <Holding key={r.ticker} r={r} />)}</ul>
        </section>
      ))}

      <GroupHead>Obligaciones negociables{ons.items.length > 0 && <span className="tabular-nums">{ons.items.length}</span>}</GroupHead>
      {ons.items.length > 0
        ? <ul>{ons.items.map(r => <Holding key={r.ticker} r={r} />)}</ul>
        : <p className="py-2 text-[13px] text-ink-3">No tenés ONs. <Link href="/ons" className="text-accent-ink underline underline-offset-2">Explorar ONs</Link></p>}

      <GroupHead>Caja</GroupHead>
      <ul>
        <li className={rowGrid}>
          <span className="row-span-2 self-start pt-0.5 font-semibold cq-wide:row-span-1 cq-wide:self-center cq-wide:pt-0">USD</span>
          <span className="col-start-2 row-start-1 min-w-0">
            <span className="block font-medium">Dólares disponibles</span>
            <span className="block text-[13px] text-ink-3">
              <span className="cq-wide:hidden">{formatNumber(cashWeightPct, { decimals: 1 })} % de la cartera{cashNote && '. '}</span>
              {cashNote}
            </span>
          </span>
          <span className={valueCell}><b className="block font-semibold">{formatNumber(cash)}</b></span>
          <span className={`${resultCell} cq-wide:text-[13px]`}>
            <button type="button" onClick={onAdjustCash} className={linkButton}>Ajustar saldo</button>
          </span>
          <span className={weightCell}>{formatNumber(cashWeightPct, { decimals: 1 })} %</span>
        </li>
      </ul>
    </div>
  )
}
