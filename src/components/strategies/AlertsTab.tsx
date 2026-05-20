'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Zap } from 'lucide-react'
import { toast } from 'sonner'
import type { Alert, IndicatorSetup } from '@/types'
import { AlertRow } from '@/components/strategies/AlertRow'

interface AlertsTabProps {
  strategyId: string
  setups: IndicatorSetup[]
}

interface NewAlertForm {
  ticker: string
  setup_id: string
  channels: string[]
}

const INITIAL_FORM: NewAlertForm = { ticker: '', setup_id: '', channels: ['telegram'] }

export function AlertsTab({ strategyId, setups }: AlertsTabProps) {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState<NewAlertForm>(INITIAL_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [triggering, setTriggering] = useState(false)

  const setupIds = useMemo(() => setups.map((s) => s.id), [setups])

  const loadAlerts = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/alerts')
      if (!res.ok) throw new Error('Error al cargar alertas')
      const data = await res.json() as { alerts: Alert[] }
      const filtered = data.alerts.filter(
        (a) => a.setup_id && setupIds.includes(a.setup_id)
      )
      setAlerts(filtered)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }, [strategyId, setupIds])

  useEffect(() => { loadAlerts() }, [loadAlerts])

  function handleAlertUpdate(id: string, patch: Partial<Pick<Alert, 'active' | 'channels'>>) {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...patch } : a))
    )
  }

  function getSetupName(setupId: string | undefined): string {
    if (!setupId) return '—'
    return setups.find((s) => s.id === setupId)?.name ?? '—'
  }

  function toggleFormChannel(ch: string) {
    setForm((prev) => {
      const current = prev.channels
      const next = current.includes(ch)
        ? current.filter((c) => c !== ch)
        : [...current, ch]
      return { ...prev, channels: next.length === 0 ? current : next }
    })
  }

  async function handleAddAlert() {
    if (!form.ticker.trim() || !form.setup_id || form.channels.length === 0) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: form.ticker.trim().toUpperCase(),
          setup_id: form.setup_id,
          channels: form.channels,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? 'Error al crear alerta')
      }
      const data = await res.json() as { alert: Alert }
      setAlerts((prev) => [data.alert, ...prev])
      setForm(INITIAL_FORM)
      setShowAddForm(false)
      toast.success('Alerta creada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear alerta')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleTriggerEvaluation() {
    if (triggering) return
    setTriggering(true)
    try {
      const res = await fetch('/api/trigger-evaluation', { method: 'POST' })
      if (res.status === 429) {
        toast.error('Rate limit: esperá 60 segundos antes de volver a evaluar')
        return
      }
      if (!res.ok) throw new Error('Error al evaluar')
      toast.success('Evaluacion iniciada')
    } catch {
      toast.error('No se pudo iniciar la evaluacion')
    } finally {
      setTriggering(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Tab header */}
      <div className="flex items-center justify-between">
        <h2 className="font-display font-700 text-white text-sm">
          Alertas
          {alerts.length > 0 && (
            <span className="ml-2 text-slate-500 font-mono text-xs">
              ({alerts.length})
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <button
            className={`btn-ghost inline-flex items-center gap-1.5 text-xs ${triggering ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={handleTriggerEvaluation}
            disabled={triggering}
            title="Evaluar ahora"
          >
            {triggering ? (
              <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
            ) : (
              <Zap className="w-3.5 h-3.5" />
            )}
            Evaluar ahora
          </button>
          <button
            className="btn-primary inline-flex items-center gap-1.5 text-xs"
            onClick={() => setShowAddForm((v) => !v)}
          >
            <Plus className="w-3.5 h-3.5" />
            Agregar alerta
          </button>
        </div>
      </div>

      {/* Add alert inline form */}
      {showAddForm && (
        <div className="glass rounded-xl p-4 border border-amber/20 flex flex-col gap-3">
          <p className="text-xs text-slate-400 font-mono">Nueva alerta</p>

          <div className="flex flex-wrap gap-3">
            {/* Ticker */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-slate-500 font-mono">Ticker</label>
              <input
                type="text"
                value={form.ticker}
                onChange={(e) => setForm((p) => ({ ...p, ticker: e.target.value }))}
                placeholder="Ej: AAPL"
                className="h-7 px-2.5 rounded-lg bg-white/[0.04] border border-white/[0.12] text-white text-xs font-mono placeholder:text-slate-600 focus:outline-none focus:border-amber/50 w-28"
              />
            </div>

            {/* Setup selector */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-slate-500 font-mono">Setup</label>
              <select
                value={form.setup_id}
                onChange={(e) => setForm((p) => ({ ...p, setup_id: e.target.value }))}
                className="h-7 px-2.5 rounded-lg bg-white/[0.04] border border-white/[0.12] text-white text-xs font-mono focus:outline-none focus:border-amber/50 min-w-[140px]"
              >
                <option value="" disabled>Seleccionar setup</option>
                {setups.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* Channels */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-slate-500 font-mono">Canales</label>
              <div className="flex items-center gap-3 h-7">
                {(['telegram', 'email'] as const).map((ch) => (
                  <label key={ch} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.channels.includes(ch)}
                      onChange={() => toggleFormChannel(ch)}
                      className="w-3.5 h-3.5 accent-amber cursor-pointer"
                    />
                    <span className="text-[11px] text-slate-400 font-mono">{ch}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              className="btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleAddAlert}
              disabled={submitting || !form.ticker.trim() || !form.setup_id || form.channels.length === 0}
            >
              {submitting ? (
                <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin inline-block" />
              ) : (
                'Crear alerta'
              )}
            </button>
            <button
              className="btn-ghost text-xs"
              onClick={() => { setShowAddForm(false); setForm(INITIAL_FORM) }}
              disabled={submitting}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-8">
          <span className="w-6 h-6 rounded-full border-2 border-amber border-t-transparent animate-spin" />
        </div>
      )}

      {/* Error */}
      {!loading && fetchError && (
        <div className="glass rounded-xl p-5 border border-white/[0.08] flex flex-col items-center gap-3">
          <p className="text-slate-400 font-mono text-sm">{fetchError}</p>
          <button className="btn-ghost text-xs" onClick={loadAlerts}>
            Reintentar
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !fetchError && alerts.length === 0 && (
        <div className="glass rounded-2xl p-8 border border-white/[0.08] flex flex-col items-center gap-3">
          <p className="text-slate-400 font-mono text-sm">Sin alertas configuradas</p>
          <button
            className="btn-primary inline-flex items-center gap-1.5 text-xs"
            onClick={() => setShowAddForm(true)}
          >
            <Plus className="w-3.5 h-3.5" />
            Crear primera alerta
          </button>
        </div>
      )}

      {/* Alert rows */}
      {!loading && !fetchError && alerts.length > 0 && (
        <div className="flex flex-col gap-3">
          {alerts.map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              setupName={getSetupName(alert.setup_id)}
              onUpdate={handleAlertUpdate}
            />
          ))}
        </div>
      )}
    </div>
  )
}
