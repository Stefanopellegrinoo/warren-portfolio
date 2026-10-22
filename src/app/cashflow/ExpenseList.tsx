'use client'

import { Trash2 } from 'lucide-react'
import type { Cashflow } from '@/types'
import { Chip, type Tone } from '@/components/resumen/ui'
import { formatDate, formatUSD } from '@/lib/utils'

export type SortKey = 'date' | 'category' | 'description' | 'amount_usd' | 'status'
export type Sort = { key: SortKey; dir: 'asc' | 'desc' }

// Fixed widths so a long description truncates instead of widening the page.
const COLUMNS: { key: SortKey; label: string; width: string; numeric?: boolean }[] = [
  { key: 'date', label: 'Fecha', width: 'w-[108px]' },
  { key: 'category', label: 'Categoría', width: 'w-[148px]' },
  { key: 'description', label: 'Descripción', width: '' },
  { key: 'amount_usd', label: 'Monto', width: 'w-[136px]', numeric: true },
]

const isOverdue = (item: Cashflow) => item.status === 'PENDIENTE' && new Date(item.date) < new Date()

function statusOf(item: Cashflow): { tone: Tone; label: string; action: string } {
  if (item.status === 'PAGADO') return { tone: 'ok', label: 'Pagado', action: 'Marcar como pendiente' }
  return { tone: isOverdue(item) ? 'danger' : 'warn', label: isOverdue(item) ? 'Vencido' : 'Pendiente', action: 'Marcar como pagado' }
}

const iconButton = 'grid h-8 w-8 place-items-center rounded-md text-ink-3 hover:bg-hover hover:text-danger max-[819px]:h-11 max-[819px]:w-11'

export default function ExpenseList({ items, sort, onSort, onToggle, onDelete }: {
  items: Cashflow[]
  sort: Sort
  onSort: (key: SortKey) => void
  onToggle: (item: Cashflow) => void
  onDelete: (item: Cashflow) => void
}) {
  const status = (item: Cashflow) => {
    const s = statusOf(item)
    return (
      <button type="button" onClick={() => onToggle(item)} aria-label={`${s.label}. ${s.action}`} title={s.action}
        className="inline-flex min-h-8 items-center rounded hover:opacity-80 max-[819px]:min-h-11">
        <Chip tone={s.tone}>{s.label}</Chip>
      </button>
    )
  }
  const remove = (item: Cashflow) => (
    <button type="button" onClick={() => onDelete(item)} aria-label={`Borrar gasto ${item.category} del ${formatDate(item.date)}`} className={iconButton}>
      <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
    </button>
  )

  return (
    <>
      <table className="w-full table-fixed border-collapse text-sm tabular-nums max-[1079px]:hidden">
        <caption className="sr-only">Gastos. Ordená con los botones del encabezado.</caption>
        <thead>
          <tr className="border-b border-line-strong text-[13px] text-ink-3">
            <th scope="col" className="w-[120px] py-2 pr-3 text-left font-medium">Estado</th>
            {COLUMNS.map(c => (
              <th key={c.key} scope="col"
                aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className={`py-2 pr-3 font-medium ${c.width} ${c.numeric ? 'text-right' : 'text-left'}`}>
                <button type="button" onClick={() => onSort(c.key)} className={`inline-flex min-h-8 items-center gap-1 hover:text-ink ${sort.key === c.key ? 'text-ink' : ''}`}>
                  {c.label}
                  {sort.key === c.key && <span aria-hidden="true">{sort.dir === 'asc' ? '↑' : '↓'}</span>}
                </button>
              </th>
            ))}
            <th scope="col" className="w-12 py-2"><span className="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id} className="border-b border-line last:border-b-0 hover:bg-hover">
              <td className="py-1.5 pr-3">{status(item)}</td>
              <td className="whitespace-nowrap py-2.5 pr-3 text-ink-2">{formatDate(item.date)}</td>
              <td className="truncate py-2.5 pr-3 font-medium">{item.category}</td>
              <td className="truncate py-2.5 pr-3 text-ink-2" title={item.description || undefined}>{item.description || '—'}</td>
              <td className="whitespace-nowrap py-2.5 pr-3 text-right font-medium">{formatUSD(-item.amount_usd)}</td>
              <td className="py-1.5 text-right">{remove(item)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="min-[1080px]:hidden">
        {items.map(item => (
          <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 border-b border-line py-2 last:border-b-0">
            <span className="min-w-0">
              <span className="block truncate font-medium">{item.category}</span>
              <small className="block truncate text-[13px] text-ink-3">
                <time dateTime={item.date}>{formatDate(item.date)}</time>
                {item.description && <> · {item.description}</>}
              </small>
            </span>
            <span className="grid justify-items-end">
              <span className="whitespace-nowrap font-medium tabular-nums">{formatUSD(-item.amount_usd)}</span>
              {status(item)}
            </span>
            {remove(item)}
          </li>
        ))}
      </ul>
    </>
  )
}
