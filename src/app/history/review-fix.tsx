'use client'

import { useState } from 'react'
import { formatDate } from '@/lib/utils'
import type { Transaction } from '@/types'
import type { TradeCurrency } from '@/lib/trade-record'
import { Choice, Field, FormError, IN_CURRENCY, TRADE_CURRENCIES, fieldCls, primaryCls, secondaryCls } from '@/components/ui/AddTransactionModal'

const cents = (n: number | null | undefined) => (n ? Math.round(n * 100) / 100 : 0)

/**
 * Corrects a flagged CEDEAR trade from its broker ticket. The server re-derives
 * the engine values with the trade-date FX (PATCH /api/transactions/[id]),
 * rebuilds the position and clears the review flag. `view` keeps ids unique:
 * the table and the list are both in the DOM, one hidden by CSS.
 */
export function ReviewFix({ tx, view, onSaved, onCancel }: { tx: Transaction; view: 'table' | 'list'; onSaved: () => void; onCancel: () => void }) {
  const [currency, setCurrency] = useState<TradeCurrency>(tx.trade_currency ?? 'ARS')
  const [count, setCount] = useState(tx.trade_quantity ?? 0)
  const [price, setPrice] = useState(cents(tx.trade_price))
  const [commission, setCommission] = useState(cents(tx.trade_commission))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (count <= 0 || price <= 0) { setError('La cantidad y el precio deben ser mayores a 0'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/transactions/${tx.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: tx.date, ticker: tx.ticker, operation: tx.operation, assetType: 'CEDEAR',
          tradeCurrency: currency, tradeQuantity: count, tradePrice: price, tradeCommission: commission, notes: tx.notes ?? '',
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || 'No se pudo guardar la corrección')
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la corrección')
    } finally {
      setSaving(false)
    }
  }

  const id = (name: string) => `fix-${name}-${view}-${tx.id}`
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-md border border-line bg-surface-2 p-4 text-left font-normal">
      <p className="text-[13px] text-ink-2">
        Cargala como figura en el comprobante del broker. Se recalcula con el dólar del {formatDate(tx.date)}.
      </p>
      <Choice name={id('currency')} legend="Moneda" options={TRADE_CURRENCIES} value={currency} onChange={setCurrency} />
      <div className="grid grid-cols-3 gap-3 max-[819px]:grid-cols-1">
        <Field id={id('qty')} label="Cantidad de CEDEARs">
          <input id={id('qty')} type="number" inputMode="decimal" min="0" step="any" value={count || ''}
            onChange={e => setCount(parseFloat(e.target.value) || 0)} className={fieldCls} required />
        </Field>
        <Field id={id('price')} label={`Precio por CEDEAR ${IN_CURRENCY[currency]}`}>
          <input id={id('price')} type="number" inputMode="decimal" min="0" step="any" value={price || ''}
            onChange={e => setPrice(parseFloat(e.target.value) || 0)} className={fieldCls} required />
        </Field>
        <Field id={id('commission')} label={`Comisión ${IN_CURRENCY[currency]}`}>
          <input id={id('commission')} type="number" inputMode="decimal" min="0" step="any" value={commission || ''}
            onChange={e => setCommission(parseFloat(e.target.value) || 0)} className={fieldCls} />
        </Field>
      </div>
      <FormError error={error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving} aria-busy={saving} className={primaryCls}>{saving ? 'Guardando…' : 'Guardar corrección'}</button>
        <button type="button" onClick={onCancel} className={secondaryCls}>Cancelar</button>
      </div>
    </form>
  )
}
