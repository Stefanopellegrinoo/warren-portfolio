'use client'

import { fmtNum, parseEsArNumber } from '@/lib/on-format'
import { cn } from '@/lib/utils'
import { field, hint, label } from '../ui'

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
    <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-start gap-4 max-[1080px]:grid-cols-2 max-[819px]:grid-cols-1">
      <fieldset className="max-[1080px]:col-span-2 max-[819px]:col-span-1">
        <legend className={cn(label, 'mb-1')}>Ingresar</legend>
        <div className="flex flex-wrap gap-x-5">
          {([['usd', 'Monto en dólares (USD)'], ['vn', 'Valor nominal (VN)']] as const).map(([id, text]) => (
            <label key={id} className="flex min-h-9 cursor-pointer items-center gap-2 max-[819px]:min-h-11">
              <input type="radio" name={`${idPrefix}-mode`} value={id} checked={values.mode === id} onChange={() => set({ mode: id })} className="h-4 w-4 accent-[var(--accent)]" />
              {text}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={A} className={label}>{values.mode === 'usd' ? 'Monto (USD)' : 'Valor nominal (VN)'}</label>
        <input id={A} className={field} type="text" inputMode="decimal" autoComplete="off" value={values.amount} aria-invalid={amountBad || undefined} aria-describedby={`${A}-hint`} onChange={(e) => set({ amount: e.target.value })} />
        <p id={`${A}-hint`} className={amountBad ? 'text-[13px] font-medium text-danger' : hint}>
          {amountBad ? FORMAT_ERROR : amountValue !== null ? `Interpretado: ${values.mode === 'usd' ? 'USD' : 'VN'} ${typed(amountValue)}` : ' '}
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={P} className={label}>Precio manual (opcional)</label>
        <input id={P} className={field} type="text" inputMode="decimal" autoComplete="off" placeholder={marketPrice != null ? fmtNum(marketPrice) : 'Precio de mercado'} value={values.price} aria-invalid={priceBad || undefined} aria-describedby={`${P}-hint`} onChange={(e) => set({ price: e.target.value })} />
        <p id={`${P}-hint`} className={priceBad ? 'text-[13px] font-medium text-danger' : hint}>
          {priceBad ? FORMAT_ERROR : priceValue !== null ? `Interpretado: ${typed(priceValue)} por 100 VN` : 'Vacío: se usa el de mercado. Es el precio sucio por cada 100 VN.'}
        </p>
      </div>
    </div>
  )
}
