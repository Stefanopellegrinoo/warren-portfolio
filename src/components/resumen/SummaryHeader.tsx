import { useEffect, useRef, useState } from 'react'
import { Plus, Upload } from 'lucide-react'
import type { Currency } from '@/lib/multicurrency'
import { CURRENCIES } from '@/lib/resumen/currency'
import { formatNumber } from '@/lib/utils'

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// The worker refreshes prices every minute; polling every 30 s shows them
// at most a minute and a half old.
const REFRESH_INTERVAL_SEC = 30

/**
 * The market status and the countdown to the next refresh. The countdown ticks here, so every
 * second re-renders this text and nothing else; at zero it asks the page to refresh (`onDue`).
 */
function RefreshStatus({ marketOpen, autoRefresh, lastRefresh, onDue }: {
  marketOpen: boolean
  autoRefresh: boolean
  lastRefresh?: string | null
  onDue: () => void
}) {
  const left = useRef(REFRESH_INTERVAL_SEC)
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_SEC)

  // Lined up with the worker's last refresh, so the poll lands just after the next one.
  useEffect(() => {
    if (!lastRefresh) return
    const elapsed = Math.floor((Date.now() - new Date(lastRefresh).getTime()) / 1000)
    left.current = Math.max(1, REFRESH_INTERVAL_SEC - (elapsed % REFRESH_INTERVAL_SEC))
    setCountdown(left.current)
  }, [lastRefresh])

  useEffect(() => {
    if (!autoRefresh || !marketOpen) return
    const timer = setInterval(() => {
      left.current -= 1
      if (left.current <= 0) {
        left.current = REFRESH_INTERVAL_SEC
        onDue()
      }
      setCountdown(left.current)
    }, 1000)
    return () => clearInterval(timer)
  }, [autoRefresh, marketOpen, onDue])

  const status = !marketOpen
    ? 'Mercado cerrado, precios al cierre.'
    : autoRefresh ? `Mercado abierto. Se actualiza en ${mmss(countdown)}.` : 'Mercado abierto. Actualización en pausa.'
  return <span aria-live="polite">{status}</span>
}

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

export default function SummaryHeader({ marketOpen, autoRefresh, lastRefresh, onRefreshDue, onToggleRefresh, onImport, onNew, currency, onCurrency, fx }: {
  /** The selector shows only when the summary carries the three views. */
  currency?: Currency
  onCurrency?: (c: Currency) => void
  /** Today's dollar in pesos, from the same live series that converts the figures. */
  fx?: { mep: number; ccl: number }
  marketOpen: boolean
  autoRefresh: boolean
  /** When the worker last refreshed prices; the countdown lines up with it. */
  lastRefresh?: string | null
  /** Called when the countdown reaches zero during market hours. */
  onRefreshDue: () => void
  onToggleRefresh: () => void
  onImport: () => void
  onNew: () => void
}) {
  const today = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="font-serif text-[2rem] font-normal leading-tight tracking-[-0.015em] max-[819px]:text-2xl">Tu cartera</h1>
        <p className="mt-1 text-[13px] text-ink-3 sm:text-sm">
          <span className="first-letter:uppercase inline-block">{today}</span>. <RefreshStatus marketOpen={marketOpen} autoRefresh={autoRefresh} lastRefresh={lastRefresh} onDue={onRefreshDue} />
          {marketOpen && (
            <button type="button" onClick={onToggleRefresh} className="ml-2 font-medium text-accent-ink underline underline-offset-2 max-[819px]:min-h-11">
              {autoRefresh ? 'Pausar' : 'Reanudar'}
            </button>
          )}
          {fx && <span className="block tabular-nums">Dólar MEP $ {formatNumber(fx.mep)} · CCL $ {formatNumber(fx.ccl)}</span>}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 max-[819px]:w-full">
        {currency && onCurrency && <CurrencySelector value={currency} onChange={onCurrency} />}
        <div className="flex gap-2 max-[819px]:w-full">
          <button type="button" onClick={onImport} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-line-strong px-4 font-medium hover:bg-hover max-[819px]:min-h-11">
            <Upload className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />Importar
          </button>
          <button type="button" onClick={onNew} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 font-medium text-primary-on hover:bg-primary-hover max-[819px]:min-h-11 max-[819px]:flex-1">
            <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />Nueva operación
          </button>
        </div>
      </div>
    </div>
  )
}
