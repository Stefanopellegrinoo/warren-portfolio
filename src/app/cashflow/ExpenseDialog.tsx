'use client'

import { useEffect, useRef, useState } from 'react'
import { EsNumberInput } from '@/components/ui/es-number-input'

const CATEGORIES = [
  'Alquiler', 'Servicios', 'Supermercado', 'Transporte', 'Salud',
  'Educación', 'Entretenimiento', 'Restaurantes', 'Ropa', 'Tecnología',
  'Impuestos', 'Seguros', 'Suscripciones', 'Honorarios', 'Inversiones',
  'Retiro', 'Depósito', 'Otro',
]

const field = 'min-h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-ink hover:border-ink-3 focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_28%,transparent)] focus-visible:outline-none'
const label = 'text-[13px] font-medium'
const blank = () => ({ date: new Date().toISOString().split('T')[0], category: 'Supermercado', description: '', amount_usd: null as number | null, status: 'PAGADO' })

export default function ExpenseDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [form, setForm] = useState(blank)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  function close() {
    setError(null)
    onClose()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/cashflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setError(d?.error || 'No se pudo guardar el gasto')
        return
      }
      setForm(blank())
      close()
      onSaved()
    } catch {
      setError('No se pudo guardar el gasto')
    } finally {
      setSaving(false)
    }
  }

  const set = (key: keyof ReturnType<typeof blank>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }))

  return (
    <dialog ref={dialog} onClose={close} aria-labelledby="expense-title"
      className="w-[min(480px,calc(100vw-32px))] rounded-lg border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-black/30">
      <form onSubmit={submit} className="grid gap-4 p-6 max-[819px]:p-4">
        <h2 id="expense-title" className="font-serif text-2xl">Nuevo gasto</h2>
        <div className="grid grid-cols-2 gap-4 max-[479px]:grid-cols-1">
          <div className="grid gap-2">
            <label htmlFor="expense-date" className={label}>Fecha</label>
            <input id="expense-date" type="date" required value={form.date} onChange={set('date')} className={field} />
          </div>
          <div className="grid gap-2">
            <label htmlFor="expense-amount" className={label}>Monto en dólares</label>
            <EsNumberInput id="expense-amount" placeholder="1.234,50" min="0.01" required value={form.amount_usd} onValue={n => setForm(f => ({ ...f, amount_usd: n }))}
              className={field} aria-invalid={!!error} aria-describedby={error ? 'expense-error' : undefined} />
          </div>
          <div className="grid gap-2">
            <label htmlFor="expense-category" className={label}>Categoría</label>
            <select id="expense-category" value={form.category} onChange={set('category')} className={field}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="grid gap-2">
            <label htmlFor="expense-status" className={label}>Estado</label>
            <select id="expense-status" value={form.status} onChange={set('status')} className={field}>
              <option value="PAGADO">Pagado</option>
              <option value="PENDIENTE">Pendiente</option>
            </select>
          </div>
        </div>
        <div className="grid gap-2">
          <label htmlFor="expense-desc" className={label}>Descripción <span className="font-normal text-ink-3">(opcional)</span></label>
          <input id="expense-desc" type="text" value={form.description} onChange={set('description')} className={field} />
        </div>
        {error && <p id="expense-error" role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="min-h-11 rounded-md px-4 font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancelar</button>
          <button type="submit" disabled={saving} aria-busy={saving} className="min-h-11 rounded-md bg-primary px-4 font-medium text-primary-on hover:bg-primary-hover disabled:opacity-70">
            Guardar gasto
          </button>
        </div>
      </form>
    </dialog>
  )
}
