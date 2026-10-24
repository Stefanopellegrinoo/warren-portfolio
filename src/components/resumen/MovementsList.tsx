'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { CashMovement } from '@/types'
import { formatNumber } from '@/lib/utils'
import { requestErrorMessage } from '@/lib/request-errors'
import { InlineConfirm } from '@/components/ui/InlineConfirm'
import { SectionHead } from './ui'

const LABELS: Record<string, string> = {
  DEPOSITO: 'Depósito', RETIRO: 'Retiro', CUPON: 'Cupón', DIVIDENDO: 'Dividendo', COMPRA: 'Compra', VENTA: 'Venta',
}
const INFLOWS = new Set(['DEPOSITO', 'CUPON', 'DIVIDENDO', 'VENTA'])
/** Movements per page; the API pages them, the history is never loaded whole. */
const PAGE = 5
// /history lists transactions, not cash movements, so the full list lives here.

const day = (iso: string) => new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })

const arrow =
  'grid h-8 w-8 place-items-center rounded-md border border-line text-ink-2 hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent max-[819px]:h-11 max-[819px]:w-11'

export default function MovementsList({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [page, setPage] = useState(0)
  const [reloads, setReloads] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  // A new operation lands on top: show the newest page again.
  const [seenKey, setSeenKey] = useState(refreshKey)
  if (seenKey !== refreshKey) { setSeenKey(refreshKey); setPage(0) }

  const request = `${page}|${refreshKey}|${reloads}`
  const [result, setResult] = useState<{ request: string; movements: CashMovement[]; total: number; failed?: boolean } | null>(null)

  useEffect(() => {
    // Only the last requested page may land: a slow earlier response must not overwrite it.
    let current = true
    fetch(`/api/cash/movements?limit=${PAGE}&offset=${page * PAGE}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => {
        if (!current) return
        const total: number = d.pagination?.total ?? 0
        // A delete can empty the last page: step back to the one that now exists.
        const last = Math.max(0, Math.ceil(total / PAGE) - 1)
        if (page > last) setPage(last)
        else setResult({ request, movements: d.data ?? [], total })
      })
      .catch(() => { if (current) setResult({ request, movements: [], total: 0, failed: true }) })
    return () => { current = false }
  }, [request, page])

  const movements = result?.movements ?? null
  const total = result?.total ?? 0
  const loading = result?.request !== request
  const failed = !!result?.failed && !loading

  async function remove(m: CashMovement) {
    setDeleting(m.id)
    setError(null)
    try {
      const res = await fetch(`/api/cash/movements/${m.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setError(d?.error || 'No se pudo borrar el movimiento')
        return
      }
      toast.success('Movimiento borrado')
      setReloads(n => n + 1)
      onChanged()
    } catch (err) {
      setError(requestErrorMessage(err, 'No se pudo borrar el movimiento'))
    } finally {
      setDeleting(null)
    }
  }

  const shown = movements ?? []
  const pages = Math.ceil(total / PAGE)
  const from = page * PAGE + 1
  const to = Math.min(total, from + shown.length - 1)

  return (
    <section aria-labelledby="h-movimientos">
      <SectionHead id="h-movimientos" title="Últimos movimientos" count={total || undefined} />
      {error && <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
      {movements === null && <span role="status" aria-label="Cargando movimientos" className="mt-3 block h-24 animate-pulse rounded bg-surface-2" />}
      {failed && (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">
          No se pudieron cargar los movimientos.
          <button type="button" onClick={() => setReloads(n => n + 1)} className="font-medium underline underline-offset-2 max-[819px]:min-h-11">Reintentar</button>
        </div>
      )}
      {movements !== null && !failed && shown.length === 0 && <p className="py-4 text-[13px] text-ink-3">Todavía no hay movimientos de caja.</p>}
      {/* With more than one page the list keeps five rows of height, so the arrows never jump. */}
      <ul id="movements-list" aria-busy={loading} className={`transition-opacity ${loading && movements ? 'opacity-60' : ''} ${pages > 1 ? 'min-h-[260px]' : ''}`}>
        {shown.map(m => {
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
                <InlineConfirm
                  question={`¿Borrás el movimiento del ${day(m.date)}?`}
                  confirmLabel="Sí, borrar"
                  onConfirm={() => void remove(m)}
                  busy={deleting === m.id}
                  triggerLabel={`Borrar movimiento del ${day(m.date)}`}
                  triggerClassName="grid h-8 w-8 place-items-center rounded-md text-ink-3 hover:bg-hover hover:text-danger disabled:opacity-50 max-[819px]:h-11 max-[819px]:w-11"
                  className="col-span-full justify-end"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                </InlineConfirm>
              )}
            </li>
          )
        })}
      </ul>
      {pages > 1 && (
        <nav aria-label="Páginas de movimientos" className="flex items-center justify-between gap-3 border-t border-line pt-3">
          <span data-testid="movements-range" aria-live="polite" className="text-[13px] tabular-nums text-ink-3">{from}–{to} de {total}</span>
          <span className="flex gap-2">
            <button type="button" onClick={() => setPage(p => p - 1)} disabled={page === 0 || loading} aria-label="Movimientos más recientes" aria-controls="movements-list" className={arrow}>
              <ChevronLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setPage(p => p + 1)} disabled={page >= pages - 1 || loading} aria-label="Movimientos anteriores" aria-controls="movements-list" className={arrow}>
              <ChevronRight className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </span>
        </nav>
      )}
    </section>
  )
}
