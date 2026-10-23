import Link from 'next/link'
import { groupRows, nextSort, sortRows, type HoldingRow, type Sort, type SortKey } from '@/lib/resumen/holdings'
import { formatNumber, formatPct } from '@/lib/utils'

// Same columns as the old positions table, restyled.
const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'ticker', label: 'Activo', numeric: false },
  { key: 'quantity', label: 'Cantidad', numeric: true },
  { key: 'price', label: 'Precio', numeric: true },
  { key: 'avgCost', label: 'Costo prom.', numeric: true },
  { key: 'invested', label: 'Invertido', numeric: true },
  { key: 'value', label: 'Valor', numeric: true },
  { key: 'dayChangePct', label: 'Hoy', numeric: true },
  { key: 'pnl', label: 'Resultado', numeric: true },
  { key: 'pnlPct', label: 'Resultado %', numeric: true },
  { key: 'weightPct', label: 'Peso', numeric: true },
]

const signColor = (n: number | null) => (n === null ? 'text-ink-3' : n > 0 ? 'text-ok' : n < 0 ? 'text-danger' : '')

/** Every column, one group per asset type, sorted by the column the user tapped. */
export default function HoldingsTable({ rows, sort, onSort, onSell }: {
  rows: HoldingRow[]
  sort: Sort
  onSort: (sort: Sort) => void
  onSell: (ticker: string) => void
}) {
  const groups = groupRows(sortRows(rows, sort)).filter(g => g.items.length > 0)
  const toggle = (key: SortKey) => onSort(nextSort(sort, key))

  return (
    // relative: the sr-only labels are absolutely positioned and would escape the scroll box, widening the page.
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[920px] border-collapse text-sm tabular-nums">
        <caption className="sr-only">Tenencias. Ordená con los botones del encabezado.</caption>
        <thead>
          <tr className="border-b border-line-strong text-[13px] text-ink-3">
            {COLUMNS.map(c => (
              <th
                key={c.key}
                scope="col"
                aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className={`py-2 pr-3 font-medium ${c.numeric ? 'text-right' : 'sticky left-0 z-[1] bg-canvas text-left'}`}
              ><button type="button" onClick={() => toggle(c.key)} className={`inline-flex min-h-8 items-center gap-1 hover:text-ink ${sort.key === c.key ? 'text-ink' : ''}`}>
                {c.label}
                {sort.key === c.key && <span aria-hidden="true">{sort.dir === 'asc' ? '↑' : '↓'}</span>}
              </button></th>
            ))}
            <th scope="col" className="py-2"><span className="sr-only">Operar</span></th>
          </tr>
        </thead>
        {groups.map(g => (
          <tbody key={g.kind}>
            <tr>
              <th scope="rowgroup" colSpan={COLUMNS.length + 1} className="pb-1 pt-5 text-left text-xs font-medium uppercase tracking-[0.06em] text-ink-3">
                {/* Stays in view while the table scrolls sideways. */}
                <span className="sticky left-0">{g.title}</span>
              </th>
            </tr>
            {g.items.map(r => (
              <tr key={r.ticker} className="border-b border-line last:border-b-0 hover:bg-hover">
                <th scope="row" className="sticky left-0 z-[1] bg-canvas py-2.5 pr-3 text-left font-normal">
                  <Link href={r.href} className="font-semibold hover:text-accent-ink">{r.ticker}</Link>
                  {r.name && <span className="ml-2 text-ink-3">{r.name}</span>}
                </th>
                <td className="py-2.5 pr-3 text-right">{r.kind === 'on' ? r.quantityLabel : formatNumber(r.quantity, { decimals: Number.isInteger(r.quantity) ? 0 : 2 })}</td>
                <td className="py-2.5 pr-3 text-right">{r.price === null ? '—' : formatNumber(r.price)}</td>
                <td className="py-2.5 pr-3 text-right">{formatNumber(r.avgCost)}</td>
                <td className="py-2.5 pr-3 text-right">{formatNumber(r.invested)}</td>
                <td className="py-2.5 pr-3 text-right">
                  {r.value === null ? '—' : formatNumber(r.value)}
                  {r.estimated && r.value !== null && <span className="block text-[13px] text-ink-3">estimado</span>}
                </td>
                <td className={`py-2.5 pr-3 text-right ${signColor(r.dayChangePct)}`}>{r.dayChangePct === null ? 'Sin precio' : formatPct(r.dayChangePct, { digits: 1 })}</td>
                <td className={`py-2.5 pr-3 text-right ${signColor(r.pnl)}`}>{r.pnl === null ? '—' : formatNumber(r.pnl, { sign: true })}</td>
                <td className={`py-2.5 pr-3 text-right ${signColor(r.pnlPct)}`}>{formatPct(r.pnlPct, { digits: 1 })}</td>
                <td className="py-2.5 pr-3 text-right">{formatNumber(r.weightPct, { decimals: 1 })} %</td>
                <td className="py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => onSell(r.ticker)}
                    aria-label={`Vender ${r.ticker}`}
                    className="min-h-8 rounded-md border border-line-strong px-3 text-[13px] font-medium hover:bg-hover max-[819px]:min-h-11"
                  >
                    Vender
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}
