'use client'

import { useEffect, useRef, useState } from 'react'
import { buildAdjustPayload } from '@/lib/cash-adjust-input'
import { argentinaDate, formatUSD } from '@/lib/utils'

const field = 'min-h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-ink hover:border-ink-3 focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_28%,transparent)] focus-visible:outline-none'

export default function AdjustCashDialog({ open, onClose, onDone, currentBalance }: {
  open: boolean
  onClose: () => void
  onDone: () => void
  currentBalance: number
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [balance, setBalance] = useState('')
  const [date, setDate] = useState(argentinaDate())
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  function close() {
    setBalance('')
    setDescription('')
    setError(null)
    setDone(null)
    onClose()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = buildAdjustPayload(balance, date, description)
    if (!parsed.ok) { setError(parsed.error); return }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/cash/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.payload),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) { setError(data?.error || 'No se pudo ajustar el saldo'); return }
      setDone(data?.adjusted ? `Ajuste registrado: ${formatUSD(data.delta)}` : 'El saldo ya coincidía. No se registró ningún movimiento.')
      onDone()
    } catch {
      setError('No se pudo ajustar el saldo')
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialog}
      onClose={close}
      aria-labelledby="adjust-title"
      className="w-[min(440px,calc(100vw-32px))] rounded-lg border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-black/30"
    >
      <form onSubmit={submit} className="grid gap-4 p-6">
        <div>
          <h2 id="adjust-title" className="font-serif text-2xl">Ajustar saldo</h2>
          <p className="mt-1 text-[13px] text-ink-3">
            Ingresá el saldo real de tu cuenta. La diferencia con {formatUSD(currentBalance)} se registra como un movimiento.
          </p>
        </div>
        <div className="grid gap-2">
          <label htmlFor="adjust-balance" className="text-[13px] font-medium">Saldo real en dólares</label>
          <input id="adjust-balance" type="number" inputMode="decimal" step="0.01" required value={balance} onChange={e => setBalance(e.target.value)} className={field} aria-invalid={!!error} aria-describedby={error ? 'adjust-error' : undefined} />
        </div>
        <div className="grid gap-2">
          <label htmlFor="adjust-date" className="text-[13px] font-medium">Fecha</label>
          <input id="adjust-date" type="date" required value={date} onChange={e => setDate(e.target.value)} className={field} />
        </div>
        <div className="grid gap-2">
          <label htmlFor="adjust-desc" className="text-[13px] font-medium">Descripción <span className="font-normal text-ink-3">(opcional)</span></label>
          <input id="adjust-desc" value={description} onChange={e => setDescription(e.target.value)} className={field} />
        </div>
        {error && <p id="adjust-error" role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
        {done && <p role="status" className="rounded-md bg-ok-soft px-3 py-2 text-[13px] text-ok">{done}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="min-h-11 rounded-md px-4 font-medium text-ink-2 hover:bg-hover hover:text-ink">
            {done ? 'Cerrar' : 'Cancelar'}
          </button>
          {!done && (
            <button type="submit" disabled={busy} aria-busy={busy} className="min-h-11 rounded-md bg-primary px-4 font-medium text-primary-on hover:bg-primary-hover disabled:opacity-70">
              Ajustar saldo
            </button>
          )}
        </div>
      </form>
    </dialog>
  )
}
