import { Plus, Upload } from 'lucide-react'

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function SummaryHeader({ marketOpen, autoRefresh, countdown, onToggleRefresh, onImport, onNew }: {
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
