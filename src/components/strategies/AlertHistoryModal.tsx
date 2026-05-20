'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface AlertHistoryEntry {
  id: string
  channel: 'telegram' | 'email'
  status: 'sent' | 'failed'
  sent_at: string
  error: string | null
  signal_id: string | null
}

interface AlertHistoryModalProps {
  alertId: string
  open: boolean
  onClose: () => void
}

function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'hace un momento'
  if (mins < 60) return `hace ${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `hace ${hrs}h`
  const days = Math.floor(hrs / 24)
  return `hace ${days}d`
}

export function AlertHistoryModal({ alertId, open, onClose }: AlertHistoryModalProps) {
  const [entries, setEntries] = useState<AlertHistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !alertId) return

    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/alerts/${alertId}/history`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Error al cargar historial')
        const data = await res.json() as { history: AlertHistoryEntry[] }
        if (!cancelled) setEntries(data.history)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error inesperado')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [open, alertId])

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Historial de alertas</DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex justify-center py-8">
            <span className="w-6 h-6 rounded-full border-2 border-amber border-t-transparent animate-spin" />
          </div>
        )}

        {!loading && error && (
          <p className="text-xs text-red-400 font-mono text-center py-4">{error}</p>
        )}

        {!loading && !error && entries.length === 0 && (
          <p className="text-xs text-slate-500 font-mono text-center py-6">
            Sin registros de envio
          </p>
        )}

        {!loading && !error && entries.length > 0 && (
          <TooltipProvider>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  <th className="text-left text-slate-500 font-mono pb-2 pr-4">Enviado</th>
                  <th className="text-left text-slate-500 font-mono pb-2 pr-4">Canal</th>
                  <th className="text-left text-slate-500 font-mono pb-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-white/[0.04] last:border-0">
                    <td className="py-2 pr-4 text-slate-400 font-mono whitespace-nowrap">
                      {relativeTime(entry.sent_at)}
                    </td>
                    <td className="py-2 pr-4">
                      <span className="px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-300 font-mono border border-white/[0.08]">
                        {entry.channel}
                      </span>
                    </td>
                    <td className="py-2">
                      {entry.status === 'sent' ? (
                        <span className="tag-positive text-[10px]">enviado</span>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger>
                            <span className="tag-neutral text-[10px] cursor-help border-b border-dashed border-slate-500">
                              fallido
                            </span>
                          </TooltipTrigger>
                          {entry.error && (
                            <TooltipContent>
                              <span className="font-mono text-xs">{entry.error}</span>
                            </TooltipContent>
                          )}
                        </Tooltip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TooltipProvider>
        )}
      </DialogContent>
    </Dialog>
  )
}
