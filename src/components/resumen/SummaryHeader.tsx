import { Plus, Upload } from 'lucide-react'
import type { Currency } from '@/lib/multicurrency'
import { CURRENCIES } from '@/lib/resumen/currency'

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/** Pesos · Dólar MEP · Dólar cable, the same segmented radio group as the chart's period. */
export function CurrencySelector({ value, onChange }: { value: Currency; onChange: (c: Currency) => void }) {
  return (
    <fieldset className="inline-flex gap-0.5 rounded-md border border-line bg-surface-2 p-0.5" aria-label="Moneda de los montos">
      {CURRENCIES.map(c => (
        <label
          key={c.id}
          className="relative inline-flex min-h-8 cursor-pointer items-center whitespace-nowrap rounded px-3 text-[13px] text-ink-2 has-[:checked]:bg-surface has-[:checked]:text-ink has-[:checked]:shadow-[0_0_0_1px_var(--line)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring max-[819px]:min-h-11 max-[819px]:px-2.5"
        >
          <input type="radio" name="resumen-currency" value={c.id} checked={value === c.id} onChange={() => onChange(c.id)} className="absolute inset-0 m-0 cursor-pointer opacity-0" />
          {c.label}
        </label>
      ))}
    </fieldset>
  )
}

export default function SummaryHeader({ marketOpen, autoRefresh, countdown, onToggleRefresh, onImport, onNew, currency, onCurrency }: {
  /** The selector shows only when the summary carries the three views. */
  currency?: Currency
  onCurrency?: (c: Currency) => void
  marketOpen: boolean
  autoRefresh: boolean
  countdown: number
  onToggleRefresh: () => void
  onImport: () => void
  onNew: () => void
}) {
  const today = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  const status = !marketOpen
    ? 'Mercado cerrado, precios al cierre.'
    : autoRefresh ? `Mercado abierto. Se actualiza en ${mmss(countdown)}.` : 'Mercado abierto. Actualización en pausa.'

  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-serif text-[2rem] font-normal leading-tight tracking-[-0.015em] max-[819px]:text-2xl">Tu cartera</h1>
        <p className="mt-1 text-ink-3">
          <span className="first-letter:uppercase inline-block">{today}</span>. <span aria-live="polite">{status}</span>
          {marketOpen && (
            <button type="button" onClick={onToggleRefresh} className="ml-2 font-medium text-accent-ink underline underline-offset-2 max-[819px]:min-h-11">
              {autoRefresh ? 'Pausar' : 'Reanudar'}
            </button>
          )}
        </p>
        {currency && onCurrency && <div className="mt-3"><CurrencySelector value={currency} onChange={onCurrency} /></div>}
      </div>
      <div className="flex gap-2 max-[819px]:w-full">
        <button type="button" onClick={onImport} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-line-strong px-4 font-medium hover:bg-hover max-[819px]:min-h-11 max-[819px]:flex-1">
          <Upload className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />Importar
        </button>
        <button type="button" onClick={onNew} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 font-medium text-primary-on hover:bg-primary-hover max-[819px]:min-h-11 max-[819px]:flex-1">
          <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />Nueva operación
        </button>
      </div>
    </div>
  )
}
