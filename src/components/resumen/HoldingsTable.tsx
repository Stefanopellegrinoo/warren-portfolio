'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { HoldingRow } from '@/lib/resumen/holdings'
import { formatNumber, formatPct } from '@/lib/utils'

type SortKey = 'ticker' | 'value' | 'dayChangePct' | 'pnl' | 'pnlPct' | 'weightPct'

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'ticker', label: 'Activo', numeric: false },
  { key: 'value', label: 'Valor', numeric: true },
  { key: 'dayChangePct', label: 'Hoy', numeric: true },
  { key: 'pnl', label: 'Resultado', numeric: true },
  { key: 'pnlPct', label: 'Resultado %', numeric: true },
  { key: 'weightPct', label: 'Peso', numeric: true },
]

const signColor = (n: number | null) => (n === null ? 'text-ink-3' : n > 0 ? 'text-ok' : n < 0 ? 'text-danger' : '')

export default function HoldingsTable({ rows, onSell }: { rows: HoldingRow[]; onSell: (ticker: string) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'value', dir: 'desc' })

  const sorted = [...rows].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key]
    if (av === null) return 1
    if (bv === null) return -1
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
    return sort.dir === 'asc' ? cmp : -cmp
  })

  function toggle(key: SortKey) {
    setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'ticker' ? 'asc' : 'desc' }))
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm tabular-nums">
        <caption className="sr-only">Tenencias. Ordená con los botones del encabezado.</caption>
        <thead>
          <tr className="border-b border-line-strong text-[13px] text-ink-3">
            {COLUMNS.map(c => (
              <th
                key={c.key}
                scope="col"
                aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className={`py-2 pr-3 font-medium ${c.numeric ? 'text-right' : 'text-left'}`}
              ><button type="button" onClick={() => toggle(c.key)} className={`inline-flex min-h-8 items-center gap-1 hover:text-ink ${sort.key === c.key ? 'text-ink' : ''}`}>
                {c.label}
                {sort.key === c.key && <span aria-hidden="true">{sort.dir === 'asc' ? '↑' : '↓'}</span>}
              </button></th>
            ))}
            <th scope="col" className="py-2"><span className="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr key={r.ticker} className="border-b border-line last:border-b-0 hover:bg-hover">
              <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                <Link href={r.href} className="font-semibold hover:text-accent-ink">{r.ticker}</Link>
                {r.name && <span className="ml-2 text-ink-3">{r.name}</span>}
              </th>
              <td className="py-2.5 pr-3 text-right">{r.value === null ? '—' : formatNumber(r.value)}</td>
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
      </table>
    </div>
  )
}
