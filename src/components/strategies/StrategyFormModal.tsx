'use client'

import { useState, useEffect, KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { Strategy } from '@/types'

const TIMEFRAMES = ['1d', '1w'] as const

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
      const message = err instanceof Error ? err.message : 'Error inesperado'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!loading) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Editar estrategia' : 'Nueva estrategia'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-slate-400 font-mono">Nombre *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Momentum + RSI"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-slate-400 font-mono">Filosofía *</label>
            <textarea
              className="input-field min-h-[120px] resize-y text-sm"
              value={philosophy}
              onChange={(e) => setPhilosophy(e.target.value)}
              placeholder="Reglas, checklist, por qué..."
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-slate-400 font-mono">
              Tickers <span className="text-slate-500">(Enter o coma para agregar)</span>
            </label>
            <div className="flex flex-wrap gap-1.5 min-h-[32px] rounded-lg border border-input bg-transparent px-2.5 py-1.5">
              {tickers.map((ticker) => (
                <span
                  key={ticker}
                  className="bg-amber/20 text-amber rounded px-2 py-0.5 flex items-center gap-1 text-sm font-mono"
                >
                  {ticker}
                  <button
                    type="button"
                    onClick={() => removeTicker(ticker)}
                    className="hover:text-white transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <input
                className="flex-1 min-w-[80px] bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value)}
                onKeyDown={handleTickerKeyDown}
                onBlur={() => { if (tickerInput.trim()) addTicker(tickerInput) }}
                placeholder={tickers.length === 0 ? 'AAPL, MSFT...' : ''}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-slate-400 font-mono">Timeframes</label>
            <div className="flex gap-2">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => toggleTimeframe(tf)}
                  className={
                    timeframes.includes(tf)
                      ? 'bg-amber/20 border border-amber text-amber rounded px-3 py-1 text-sm font-mono transition-colors'
                      : 'border border-tv-border text-slate-400 rounded px-3 py-1 text-sm font-mono transition-colors hover:border-slate-500'
                  }
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          {isEdit && (
            <div className="flex items-center gap-2">
              <input
                id="active-toggle"
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="w-4 h-4 accent-amber cursor-pointer"
              />
              <label htmlFor="active-toggle" className="text-sm text-slate-300 cursor-pointer">
                Estrategia activa
              </label>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400 font-mono">{error}</p>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary text-xs inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSubmit}
            disabled={isDisabled}
          >
            {loading && (
              <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
            )}
            Guardar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
