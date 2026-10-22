'use client'

import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { CashMovement } from '@/types'
import { formatNumber } from '@/lib/utils'
import { SectionHead } from './ui'

const LABELS: Record<string, string> = {
  DEPOSITO: 'Depósito', RETIRO: 'Retiro', CUPON: 'Cupón', DIVIDENDO: 'Dividendo', COMPRA: 'Compra', VENTA: 'Venta',
}
const INFLOWS = new Set(['DEPOSITO', 'CUPON', 'DIVIDENDO', 'VENTA'])
const SHOWN = 4
// /history lists transactions, not cash movements, so the full list lives here.

const day = (iso: string) => new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })

export default function MovementsList({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [movements, setMovements] = useState<CashMovement[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(() => {
    fetch('/api/cash/movements')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => setMovements(d.data ?? []))
      .catch(() => setMovements([]))
  }, [])

  useEffect(() => { load() }, [load, refreshKey])

  async function remove(m: CashMovement) {
    if (!confirm(`¿Borrás el movimiento del ${day(m.date)}?`)) return
    setDeleting(m.id)
    setError(null)
    try {
      const res = await fetch(`/api/cash/movements/${m.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setError(d?.error || 'No se pudo borrar el movimiento')
        return
      }
      load()
      onChanged()
    } finally {
      setDeleting(null)
    }
  }

  const all = movements ?? []
  const recent = expanded ? all : all.slice(0, SHOWN)
  const toggle = all.length > SHOWN && (
    <button type="button" onClick={() => setExpanded(e => !e)} aria-expanded={expanded} aria-controls="movements-list"
      className="inline-flex min-h-6 items-center text-[13px] font-medium text-accent-ink hover:underline hover:underline-offset-2 max-[819px]:min-h-11">
      {expanded ? 'Ver menos' : `Ver todos (${all.length})`}
    </button>
  )

  return (
    <section aria-labelledby="h-movimientos">
      <SectionHead id="h-movimientos" title="Últimos movimientos" action={toggle || undefined} />
      {error && <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
      {movements === null && <span role="status" aria-label="Cargando movimientos" className="mt-3 block h-24 animate-pulse rounded bg-surface-2" />}
      {movements !== null && recent.length === 0 && <p className="py-4 text-[13px] text-ink-3">Todavía no hay movimientos de caja.</p>}
      <ul id="movements-list">
        {recent.map(m => {
          const inflow = INFLOWS.has(m.type)
          const amount = inflow ? Math.abs(m.amount) : -Math.abs(m.amount)
          const detail = [LABELS[m.type] ?? m.type, m.ticker].filter(Boolean).join(' ')
          return (
            <li key={m.id} className="grid min-h-[52px] grid-cols-[56px_minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-line py-2 last:border-b-0 max-[819px]:grid-cols-[48px_minmax(0,1fr)_auto_auto]">
              <time dateTime={m.date} className="text-[13px] font-medium tabular-nums">
                {day(m.date)}<small className="block text-xs font-normal text-ink-3">{m.date.slice(0, 4)}</small>
              </time>
              <span className="min-w-0 font-medium">
                {detail}
                {m.description && <small className="block truncate text-[13px] font-normal text-ink-3">{m.description}</small>}
              </span>
              <span className={`font-medium tabular-nums ${inflow ? 'text-ok' : 'text-danger'}`}>{formatNumber(amount, { sign: true })}</span>
              {m.transaction_id ? (
                <span className="w-8" title="Lo generó una operación: borrá la operación para revertirlo" />
              ) : (
                <button
                  type="button"
                  onClick={() => remove(m)}
                  disabled={deleting === m.id}
                  aria-label={`Borrar movimiento del ${day(m.date)}`}
                  className="grid h-8 w-8 place-items-center rounded-md text-ink-3 hover:bg-hover hover:text-danger disabled:opacity-50 max-[819px]:h-11 max-[819px]:w-11"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
