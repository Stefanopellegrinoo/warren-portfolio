'use client'

import { useState, useEffect } from 'react'
import { formatUSD, cn } from '@/lib/utils'
import type { CashMovement } from '@/types'
import { Banknote, ArrowUpCircle, ArrowDownCircle, Trash2, RefreshCw } from 'lucide-react'

interface Props {
  balance: number
  loading?: boolean
  onMovementDeleted?: () => void
}

const OP_LABELS: Record<string, string> = {
  DEPOSITO: 'Depósito',
  RETIRO: 'Retiro',
  CUPON: 'Cupón',
  DIVIDENDO: 'Dividendo',
}

const OP_COLORS: Record<string, string> = {
  DEPOSITO: 'text-emerald',
  CUPON: 'text-emerald',
  DIVIDENDO: 'text-emerald',
  RETIRO: 'text-rose',
}

export default function CashSection({ balance, loading, onMovementDeleted }: Props) {
  const [movements, setMovements] = useState<CashMovement[]>([])
  const [movLoading, setMovLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function fetchMovements() {
    setMovLoading(true)
    try {
      const res = await fetch('/api/cash/movements')
      if (res.ok) {
        const data = await res.json()
        // API returns PaginatedResponse with data.data
        setMovements(data.data ?? [])
      }
    } catch (err) {
      console.error('Error fetching cash movements', err)
    } finally {
      setMovLoading(false)
    }
  }

  useEffect(() => {
    fetchMovements()
  }, [balance]) // refetch when balance changes (after new movement)

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminás este movimiento?')) return
    setDeleting(id)
    setError(null)
    try {
      const res = await fetch(`/api/cash/movements/${id}`, { method: 'DELETE' })
      if (res.ok) {
        await fetchMovements()
        onMovementDeleted?.()
      } else {
        const d = await res.json().catch(() => null)
        setError(d?.error || 'Error al eliminar el movimiento')
      }
    } catch (err) {
      console.error('Error deleting movement', err)
    } finally {
      setDeleting(null)
    }
  }

  if (loading) return (
    <div className="glass rounded-2xl p-8 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-emerald/30 border-t-emerald rounded-full animate-spin" />
    </div>
  )

  // Recent movements (last 8)
  const recent = movements.slice(0, 8)

  return (
    <div className="glass rounded-2xl overflow-hidden">
      {/* Header + Balance */}
      <div className="px-5 py-4 border-b border-white/[0.05]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald/15 flex items-center justify-center">
              <Banknote className="w-4 h-4 text-emerald" />
            </div>
            <div>
              <h3 className="font-display font-700 text-white">Cash USD</h3>
              <p className="text-[11px] text-slate-500 font-mono mt-0.5">Liquidez disponible</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-mono text-slate-500 uppercase">Saldo actual</p>
            <p className={cn('font-mono font-800 text-2xl mt-0.5', balance >= 0 ? 'text-emerald' : 'text-rose')}>
              {formatUSD(balance)}
            </p>
          </div>
        </div>
      </div>

      {/* Movements list */}
      <div className="px-5 py-3">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-mono text-slate-500 uppercase tracking-widest">
            Últimos movimientos
          </p>
          <button onClick={fetchMovements} className="text-slate-600 hover:text-slate-400 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 bg-rose/10 border border-rose/20 rounded-lg text-rose text-xs font-mono">
            {error}
          </div>
        )}

        {movLoading ? (
          <div className="flex justify-center py-6">
            <div className="w-5 h-5 border-2 border-slate-700 border-t-slate-400 rounded-full animate-spin" />
          </div>
        ) : recent.length === 0 ? (
          <div className="text-center py-6 text-slate-600 font-mono text-sm">
            Sin movimientos · Hacé un depósito para empezar
          </div>
        ) : (
          <div className="space-y-1">
            {recent.map(m => {
              const isInflow = m.type === 'DEPOSITO' || m.type === 'CUPON' || m.type === 'DIVIDENDO'
              return (
                <div key={m.id} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-white/[0.02] transition-colors group">
                  {/* Icon */}
                  <div className="shrink-0">
                    {isInflow
                      ? <ArrowUpCircle className="w-4 h-4 text-emerald" />
                      : <ArrowDownCircle className="w-4 h-4 text-rose" />
                    }
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-600 text-slate-300">
                        {OP_LABELS[m.type] ?? m.type}
                      </span>
                      {m.description && (
                        <span className="text-[10px] font-mono text-slate-600 truncate max-w-32">{m.description}</span>
                      )}
                    </div>
                    <p className="text-[10px] font-mono text-slate-600">
                      {new Date(m.date).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' })}
                    </p>
                  </div>

                  {/* Amount */}
                  <div className="text-right shrink-0">
                    <span className={cn('font-mono text-sm font-700', OP_COLORS[m.type] ?? 'text-slate-400')}>
                      {isInflow ? '+' : '-'}{formatUSD(Math.abs(m.amount))}
                    </span>
                  </div>

                  {/* Delete button */}
                  <button
                    onClick={() => handleDelete(m.id)}
                    disabled={deleting === m.id}
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-slate-700 hover:text-rose transition-all duration-150"
                  >
                    {deleting === m.id
                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      : <Trash2 className="w-3.5 h-3.5" />
                    }
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {movements.length > 8 && (
          <p className="text-[10px] text-slate-600 font-mono text-center mt-3">
            +{movements.length - 8} movimientos anteriores
          </p>
        )}
      </div>
    </div>
  )
}
