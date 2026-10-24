'use client'

import { useState, useEffect, KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { requestErrorMessage } from '@/lib/request-errors'
import { DialogActions, StrategyDialog, field, ghostButton, label, primaryButton } from './ui'
import type { Strategy } from '@/types'

const TIMEFRAMES = ['1d', '1w'] as const
const TIMEFRAME_LABELS: Record<string, string> = { '1d': 'Diario (1d)', '1w': 'Semanal (1w)' }

interface StrategyFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  strategy?: Strategy
  onSuccess: (strategy: Strategy) => void
}

export function StrategyFormModal({
  open,
  onOpenChange,
  strategy,
  onSuccess,
}: StrategyFormModalProps) {
  const isEdit = !!strategy

  const [name, setName] = useState('')
  const [philosophy, setPhilosophy] = useState('')
  const [tickers, setTickers] = useState<string[]>([])
  const [tickerInput, setTickerInput] = useState('')
  const [timeframes, setTimeframes] = useState<string[]>([])
  const [active, setActive] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(strategy?.name ?? '')
      setPhilosophy(strategy?.philosophy ?? '')
      setTickers(strategy?.tickers ?? [])
      setTimeframes(strategy?.timeframes ?? [])
      setActive(strategy?.active ?? true)
      setTickerInput('')
      setError(null)
    }
  }, [open, strategy])

  function addTicker(raw: string) {
    const value = raw.trim().toUpperCase()
    if (value && !tickers.includes(value)) {
      setTickers((prev) => [...prev, value])
    }
    setTickerInput('')
  }

  function handleTickerKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTicker(tickerInput)
    }
  }

  function removeTicker(ticker: string) {
    setTickers((prev) => prev.filter((t) => t !== ticker))
  }

  function toggleTimeframe(tf: string) {
    setTimeframes((prev) =>
      prev.includes(tf) ? prev.filter((t) => t !== tf) : [...prev, tf]
    )
  }

  const isDisabled = !name.trim() || !philosophy.trim() || loading

  async function handleSubmit() {
    setError(null)
    setLoading(true)

    const body = isEdit
      ? { name, philosophy, tickers, timeframes, active }
      : { name, philosophy, tickers, timeframes }

    try {
      const url = isEdit ? `/api/strategies/${strategy!.id}` : '/api/strategies'
      const method = isEdit ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Error al guardar la estrategia')
      }

      const data = await res.json()
      const { strategy: saved } = data as { strategy: Strategy }

      toast.success(isEdit ? 'Estrategia actualizada' : 'Estrategia creada')
      onSuccess(saved)
      onOpenChange(false)
    } catch (err) {
      const message = requestErrorMessage(err, 'No se pudo guardar la estrategia.')
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!loading) onOpenChange(o) }}>
      <StrategyDialog title={isEdit ? 'Editar estrategia' : 'Nueva estrategia'}>
        <form onSubmit={(e) => { e.preventDefault(); if (!isDisabled) handleSubmit() }}>
          <div className="grid gap-4 px-5 py-5">
            <div className="grid gap-2">
              <label htmlFor="strategy-name" className={label}>Nombre</label>
              <input
                id="strategy-name"
                required
                className={field}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej.: Momentum con RSI"
              />
            </div>

            <div className="grid gap-2">
              <label htmlFor="strategy-philosophy" className={label}>Filosofía</label>
              <textarea
                id="strategy-philosophy"
                required
                className={cn(field, 'min-h-[120px] resize-y py-2 leading-relaxed max-[819px]:min-h-[120px]')}
                value={philosophy}
                onChange={(e) => setPhilosophy(e.target.value)}
                placeholder="Reglas, checklist, por qué la seguís"
              />
            </div>

            <div className="grid gap-2">
              <label htmlFor="strategy-ticker" className={label}>
                Tickers <span className="font-normal text-ink-3">(Enter o coma para agregar)</span>
              </label>
              {tickers.length > 0 && (
                <ul aria-label="Tickers agregados" className="flex flex-wrap gap-1.5">
                  {tickers.map((ticker) => (
                    <li key={ticker} className="inline-flex h-7 items-center gap-1 rounded border border-line bg-surface-2 pl-2 text-[13px] font-medium max-[819px]:h-11">
                      {ticker}
                      <button
                        type="button"
                        onClick={() => removeTicker(ticker)}
                        aria-label={`Quitar ${ticker}`}
                        className="grid h-7 w-7 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink max-[819px]:h-11 max-[819px]:w-11"
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <input
                id="strategy-ticker"
                className={field}
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value)}
                onKeyDown={handleTickerKeyDown}
                onBlur={() => { if (tickerInput.trim()) addTicker(tickerInput) }}
                placeholder={tickers.length === 0 ? 'AAPL, MSFT' : ''}
                autoCapitalize="characters"
              />
            </div>

            <fieldset className="grid gap-2">
              <legend className={`${label} mb-2`}>Timeframes</legend>
              <div className="flex flex-wrap gap-4">
                {TIMEFRAMES.map((tf) => (
                  <label key={tf} className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm max-[819px]:min-h-11">
                    <input
                      type="checkbox"
                      checked={timeframes.includes(tf)}
                      onChange={() => toggleTimeframe(tf)}
                      className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
                    />
                    {TIMEFRAME_LABELS[tf]}
                  </label>
                ))}
              </div>
            </fieldset>

            {isEdit && (
              <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm max-[819px]:min-h-11">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
                />
                Estrategia activa
              </label>
            )}

            {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
          </div>

          <DialogActions>
            <button type="button" className={ghostButton} onClick={() => onOpenChange(false)} disabled={loading}>
              Cancelar
            </button>
            <button type="submit" className={primaryButton} disabled={isDisabled} aria-busy={loading}>
              {loading ? 'Guardando…' : 'Guardar'}
            </button>
          </DialogActions>
        </form>
      </StrategyDialog>
    </Dialog>
  )
}
