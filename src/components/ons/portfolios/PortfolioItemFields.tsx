'use client'

import { fmtNum, parseEsArNumber } from '@/lib/on-format'

export interface ItemFieldValues {
  mode: 'usd' | 'vn'
  amount: string
  price: string
}

export type ParsedFields = { ok: true; mode: 'usd' | 'vn'; amount: number; manualPrice: number | null } | { ok: false; error: string }

const FORMAT_ERROR = 'Formato de número inválido'

export function parseFields(v: ItemFieldValues): ParsedFields {
  const amount = parseEsArNumber(v.amount)
  if (amount === null) return { ok: false, error: v.amount.trim() === '' ? 'Ingresá un monto' : FORMAT_ERROR }
  if (!(amount > 0)) return { ok: false, error: 'Ingresá un monto mayor a cero' }
  if (v.price.trim() === '') return { ok: true, mode: v.mode, amount, manualPrice: null }
  const manualPrice = parseEsArNumber(v.price)
  if (manualPrice === null) return { ok: false, error: FORMAT_ERROR }
  if (!(manualPrice > 0)) return { ok: false, error: 'El precio manual debe ser mayor a cero' }
  return { ok: true, mode: v.mode, amount, manualPrice }
}

const typed = (x: number) => new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(x)
/** A stored number back into the text a user would type (es-AR, round-trips through parseEsArNumber). */
export const toFieldText = (x: number | null) => (x === null ? '' : new Intl.NumberFormat('es-AR', { maximumFractionDigits: 6 }).format(x))

interface Props {
  idPrefix: string
  values: ItemFieldValues
  onChange: (next: ItemFieldValues) => void
  marketPrice?: number | null
}

/** Amount kind + amount + optional manual price, with the same "Interpretado:" echo as the single-ON simulator. */
export default function PortfolioItemFields({ idPrefix, values, onChange, marketPrice }: Props) {
  const amountValue = parseEsArNumber(values.amount)
  const amountBad = values.amount.trim() !== '' && amountValue === null
  const priceValue = values.price.trim() === '' ? null : parseEsArNumber(values.price)
  const priceBad = values.price.trim() !== '' && priceValue === null
  const set = (patch: Partial<ItemFieldValues>) => onChange({ ...values, ...patch })
  const A = `${idPrefix}-amount`
  const P = `${idPrefix}-price`
  return (
    <div className="grid gap-3 sm:grid-cols-[auto_1fr_1fr] sm:items-start">
      <fieldset>
        <legend className="mb-1 text-[11px] font-mono uppercase tracking-widest text-slate-400">Ingresar</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {([['usd', 'Monto en dólares (USD)'], ['vn', 'Valor nominal (VN)']] as const).map(([id, label]) => (
            <label key={id} className="flex items-center gap-2 text-sm text-slate-200">
              <input type="radio" name={`${idPrefix}-mode`} value={id} checked={values.mode === id} onChange={() => set({ mode: id })} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor={A} className="text-[11px] font-mono uppercase tracking-widest text-slate-400">{values.mode === 'usd' ? 'Monto (USD)' : 'Valor nominal (VN)'}</label>
        <input id={A} className="input-field" type="text" inputMode="decimal" autoComplete="off" value={values.amount} aria-invalid={amountBad || undefined} aria-describedby={`${A}-hint`} onChange={(e) => set({ amount: e.target.value })} />
        <p id={`${A}-hint`} className={`text-[11px] ${amountBad ? 'text-amber' : 'text-slate-400'}`}>
          {amountBad ? FORMAT_ERROR : amountValue !== null ? `Interpretado: ${values.mode === 'usd' ? 'USD' : 'VN'} ${typed(amountValue)}` : ' '}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={P} className="text-[11px] font-mono uppercase tracking-widest text-slate-400">Precio manual (opcional, sucio por 100 VN)</label>
        <input id={P} className="input-field" type="text" inputMode="decimal" autoComplete="off" placeholder={marketPrice != null ? fmtNum(marketPrice) : 'Precio de mercado'} value={values.price} aria-invalid={priceBad || undefined} aria-describedby={`${P}-hint`} onChange={(e) => set({ price: e.target.value })} />
        <p id={`${P}-hint`} className={`text-[11px] ${priceBad ? 'text-amber' : 'text-slate-400'}`}>
          {priceBad ? FORMAT_ERROR : priceValue !== null ? `Interpretado: ${typed(priceValue)} por 100 VN` : ' '}
        </p>
      </div>
    </div>
  )
}
