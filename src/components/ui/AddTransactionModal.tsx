'use client'

import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Operation, TransactionInput } from '@/types'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

const OPERATIONS: Operation[] = ['COMPRA', 'VENTA', 'DIVIDENDO']

export default function AddTransactionModal({ onClose, onSuccess }: Props) {
  const [form, setForm] = useState<TransactionInput>({
    date: new Date().toISOString().split('T')[0],
    ticker: '',
    operation: 'COMPRA',
    quantity: 0,
    price: 0,
    commission: 0,
    notes: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof TransactionInput, value: string | number) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.ticker.trim()) { setError('Ingresá el ticker'); return }
    if (form.quantity <= 0) { setError('La cantidad debe ser mayor a 0'); return }
    if (form.price <= 0) { setError('El precio debe ser mayor a 0'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, ticker: form.ticker.toUpperCase().trim() }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Error al guardar')
      }
      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md glass rounded-2xl p-4 md:p-6 animate-slide-up border border-white/10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="font-display font-700 text-lg text-white">Nueva Operación</h2>
            <p className="text-xs text-slate-500 font-mono mt-0.5">El costo promedio se recalcula automáticamente</p>
          </div>
          <button onClick={onClose} className="text-slate-600 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Operation selector */}
          <div>
            <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Operación</label>
            <div className="grid grid-cols-3 gap-1.5">
              {OPERATIONS.map(op => (
                <button key={op} type="button"
                  onClick={() => set('operation', op)}
                  className={cn(
                    'py-2 rounded-lg text-xs font-display font-600 transition-all duration-150 border',
                    form.operation === op
                      ? op === 'COMPRA' ? 'bg-emerald/20 text-emerald border-emerald/40'
                        : op === 'VENTA' ? 'bg-rose/20 text-rose border-rose/40'
                        : 'bg-amber/20 text-amber border-amber/40'
                      : 'bg-bg-700 text-slate-500 border-bg-500 hover:border-slate-500'
                  )}>
                  {op}
                </button>
              ))}
            </div>
          </div>

          {/* Date + Ticker */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Fecha</label>
              <input type="date" value={form.date}
                onChange={e => set('date', e.target.value)}
                className="input-field w-full" required />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Ticker</label>
              <input type="text" placeholder="NASDAQ:NVDA"
                value={form.ticker}
                onChange={e => set('ticker', e.target.value.toUpperCase())}
                className="input-field w-full" required />
            </div>
          </div>

          {/* Qty + Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Cantidad</label>
              <input type="number" min="0" step="any" placeholder="10"
                value={form.quantity || ''}
                onChange={e => set('quantity', parseFloat(e.target.value) || 0)}
                className="input-field w-full" required />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Precio</label>
              <input type="number" min="0" step="any" placeholder="190.70"
                value={form.price || ''}
                onChange={e => set('price', parseFloat(e.target.value) || 0)}
                className="input-field w-full" required />
            </div>
          </div>

          {/* Commission + Notes */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Comisión</label>
              <input type="number" min="0" step="any" placeholder="0"
                value={form.commission || ''}
                onChange={e => set('commission', parseFloat(e.target.value) || 0)}
                className="input-field w-full" />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Notas</label>
              <input type="text" placeholder="Opcional"
                value={form.notes ?? ''}
                onChange={e => set('notes', e.target.value)}
                className="input-field w-full" />
            </div>
          </div>

          {/* Total preview */}
          {form.quantity > 0 && form.price > 0 && (
            <div className="bg-bg-700 rounded-lg px-4 py-3 flex justify-between items-center">
              <span className="text-xs text-slate-500 font-mono">Total estimado</span>
              <span className="font-mono font-600 text-amber">
                ${((form.quantity * form.price) + (form.commission ?? 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {error && (
            <p className="text-rose text-xs font-mono bg-rose/10 rounded-lg px-3 py-2 border border-rose/20">{error}</p>
          )}

          <button type="submit" disabled={loading}
            className="btn-primary w-full flex items-center justify-center gap-2 py-2.5">
            {loading ? (
              <div className="w-4 h-4 border-2 border-bg-900/30 border-t-bg-900 rounded-full animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            {loading ? 'Guardando...' : 'Guardar Operación'}
          </button>
        </form>
      </div>
    </div>
  )
}
