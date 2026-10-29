'use client'

import { useEffect, useRef, useState } from 'react'
import type { DepositDatesProposal } from '@/lib/deposit-dates'
import { formatDate, formatUSD } from '@/lib/utils'

const field = 'min-h-11 rounded-md border border-line-strong bg-surface px-3 text-ink hover:border-ink-3 focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_28%,transparent)] focus-visible:outline-none'
const LOAD_FAILED = 'No se pudo armar la propuesta.'
const SAVE_FAILED = 'No se pudieron guardar las fechas.'

const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
const key = (id: string, i: number) => `${id}:${i}`

/**
 * "Revisar fechas de depósitos" (odd/tasks/deposit-dates.md S2, S3): the proposal first, every
 * part's date editable (never on its deposit's day or later), saved only when the user confirms.
 */
export default function DepositDatesDialog({ open, onClose, onDone }: {
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [proposal, setProposal] = useState<DepositDatesProposal | null>(null)
  const [dates, setDates] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  // A fresh proposal every time it opens: the movements may have changed since.
  useEffect(() => {
    if (!open) return
    let live = true
    setProposal(null)
    setError(null)
    setDone(null)
    fetch('/api/cash/deposit-dates')
      .then(async res => {
        const data = await res.json().catch(() => null)
        if (!live) return
        if (!res.ok || !Array.isArray(data?.deposits)) { setError(data?.error || LOAD_FAILED); return }
        setProposal(data)
        setDates(Object.fromEntries((data as DepositDatesProposal).deposits.flatMap(d => d.parts.map((p, i) => [key(d.id, i), p.date]))))
      })
      .catch(() => { if (live) setError(LOAD_FAILED) })
    return () => { live = false }
  }, [open])

  function close() {
    setError(null)
    setDone(null)
    onClose()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!proposal) return
    setBusy(true)
    setError(null)
    try {
      const deposits = proposal.deposits.map(d => ({ id: d.id, parts: d.parts.map((p, i) => ({ date: dates[key(d.id, i)], amount: p.amount })) }))
      const res = await fetch('/api/cash/deposit-dates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deposits }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) { setError(data?.error || SAVE_FAILED); return }
      setDone(`Listo: guardamos ${data?.saved} fechas. El total depositado no cambió.`)
      onDone()
    } catch {
      setError(SAVE_FAILED)
    } finally {
      setBusy(false)
    }
  }

  const empty = proposal?.deposits.length === 0

  return (
    <dialog
      ref={dialog}
      onClose={close}
      aria-labelledby="deposit-dates-title"
      className="w-[min(520px,calc(100vw-32px))] rounded-lg border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-black/30"
    >
      <form onSubmit={submit} className="grid gap-4 p-6">
        <div>
          <h2 id="deposit-dates-title" className="font-serif text-2xl">Revisar fechas de depósitos</h2>
          {!empty && (
            <p className="mt-1 text-[13px] text-ink-3">
              Algunas compras quedaron registradas antes de los depósitos que las pagaron. Te proponemos repartir cada
              depósito en esas fechas; si sabés la fecha real de una parte, cambiala. El total depositado no cambia.
            </p>
          )}
        </div>

        {!proposal && !error && <span role="status" aria-label="Armando la propuesta" className="block h-24 animate-pulse rounded bg-surface-2" />}
        {empty && <p className="text-sm text-ink-2">Tus depósitos ya están en fecha: no hay nada para revisar.</p>}

        {proposal && !empty && (
          <div className="grid max-h-[55vh] gap-5 overflow-y-auto pr-1">
            {proposal.deposits.map(d => (
              <section key={d.id} aria-labelledby={`dep-${d.id}`} className="grid gap-2">
                <h3 id={`dep-${d.id}`} className="text-sm font-medium">
                  Tu depósito del {formatDate(d.date)} pagó compras desde el {formatDate(d.parts[0].date)}: ¿lo repartimos en esas fechas?
                </h3>
                <ul className="grid gap-1.5">
                  {d.parts.map((p, i) => (
                    <li key={key(d.id, i)} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                      <input
                        type="date"
                        required
                        aria-label={`Fecha de la parte de ${formatUSD(p.amount)}`}
                        max={dayBefore(d.date)}
                        value={dates[key(d.id, i)] ?? p.date}
                        onChange={e => setDates(prev => ({ ...prev, [key(d.id, i)]: e.target.value }))}
                        className={field}
                      />
                      <span className="text-right text-sm tabular-nums">{formatUSD(p.amount)}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[13px] text-ink-3">
                  {d.remaining > 0.005 ? `Queda el ${formatDate(d.date)}: ${formatUSD(d.remaining)}` : `No queda nada el ${formatDate(d.date)}.`}
                </p>
              </section>
            ))}
          </div>
        )}

        {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
        {done && <p role="status" className="rounded-md bg-ok-soft px-3 py-2 text-[13px] text-ok">{done}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="min-h-11 rounded-md px-4 font-medium text-ink-2 hover:bg-hover hover:text-ink">
            {done || empty ? 'Cerrar' : 'Cancelar'}
          </button>
          {proposal && !empty && !done && (
            <button type="submit" disabled={busy} aria-busy={busy} className="min-h-11 rounded-md bg-primary px-4 font-medium text-primary-on hover:bg-primary-hover disabled:opacity-70">
              Guardar fechas
            </button>
          )}
        </div>
      </form>
    </dialog>
  )
}
