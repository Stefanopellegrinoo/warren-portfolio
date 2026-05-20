'use client'

import { useState } from 'react'
import { History } from 'lucide-react'
import { toast } from 'sonner'
import type { Alert } from '@/types'
import { AlertHistoryModal } from '@/components/strategies/AlertHistoryModal'

interface AlertRowProps {
  alert: Alert
  setupName: string
  onUpdate: (id: string, patch: Partial<Pick<Alert, 'active' | 'channels'>>) => void
}

const CHANNELS = ['telegram', 'email'] as const

export function AlertRow({ alert, setupName, onUpdate }: AlertRowProps) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [updating, setUpdating] = useState(false)

  async function handleToggleActive() {
    if (updating) return
    setUpdating(true)
    try {
      const res = await fetch(`/api/alerts/${alert.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !alert.active }),
      })
      if (!res.ok) throw new Error('Error al actualizar')
      onUpdate(alert.id, { active: !alert.active })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al actualizar alerta')
    } finally {
      setUpdating(false)
    }
  }

  async function handleChannelToggle(channel: 'telegram' | 'email') {
    if (updating) return
    const current = alert.channels as string[]
    const next = current.includes(channel)
      ? current.filter((c) => c !== channel)
      : [...current, channel]

    // Require at least one channel
    if (next.length === 0) return

    setUpdating(true)
    try {
      const res = await fetch(`/api/alerts/${alert.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: next }),
      })
      if (!res.ok) throw new Error('Error al actualizar canales')
      onUpdate(alert.id, { channels: next })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al actualizar canales')
    } finally {
      setUpdating(false)
    }
  }

  return (
    <>
      <div className="glass rounded-xl p-4 border border-white/[0.08] flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Ticker + setup name */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded-full bg-amber/10 text-amber text-[11px] font-mono border border-amber/20">
              {alert.ticker}
            </span>
            <span className="text-slate-400 text-xs font-mono truncate">{setupName}</span>
          </div>

          {/* Channel checkboxes */}
          <div className="flex items-center gap-4 mt-2">
            {CHANNELS.map((ch) => {
              const checked = (alert.channels as string[]).includes(ch)
              return (
                <label
                  key={ch}
                  className="flex items-center gap-1.5 cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => handleChannelToggle(ch)}
                    disabled={updating}
                    className="w-3.5 h-3.5 accent-amber cursor-pointer disabled:cursor-not-allowed"
                  />
                  <span className="text-[11px] text-slate-400 font-mono">{ch}</span>
                </label>
              )
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Active toggle */}
          <button
            className={`btn-ghost text-xs px-2.5 py-1 ${updating ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={handleToggleActive}
            disabled={updating}
            title={alert.active ? 'Desactivar alerta' : 'Activar alerta'}
          >
            {updating ? (
              <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin inline-block" />
            ) : (
              <span
                className={
                  alert.active
                    ? 'tag-positive text-[10px]'
                    : 'tag-neutral text-[10px]'
                }
              >
                {alert.active ? 'activa' : 'inactiva'}
              </span>
            )}
          </button>

          {/* Ver historial */}
          <button
            className="btn-ghost p-1.5 inline-flex items-center gap-1 text-xs"
            onClick={() => setHistoryOpen(true)}
            title="Ver historial"
          >
            <History className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px]">Ver historial</span>
          </button>
        </div>
      </div>

      <AlertHistoryModal
        alertId={alert.id}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
    </>
  )
}
