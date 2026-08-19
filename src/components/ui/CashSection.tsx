'use client'

import { useState, useEffect } from 'react'
import { formatUSD, cn } from '@/lib/utils'
import type { CashMovement } from '@/types'
import { buildAdjustPayload } from '@/lib/cash-adjust-input'
import { Banknote, ArrowUpCircle, ArrowDownCircle, Trash2, RefreshCw, SlidersHorizontal } from 'lucide-react'

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
  COMPRA: 'Compra',
  VENTA: 'Venta',
}

const OP_COLORS: Record<string, string> = {
  DEPOSITO: 'text-emerald',
  CUPON: 'text-emerald',
  DIVIDENDO: 'text-emerald',
  VENTA: 'text-emerald',
  RETIRO: 'text-rose',
  COMPRA: 'text-rose',
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}

export default function CashSection({ balance, loading, onMovementDeleted }: Props) {
  const [movements, setMovements] = useState<CashMovement[]>([])
  const [movLoading, setMovLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Balance reconciliation
  const [showAdjust, setShowAdjust] = useState(false)
  const [targetBalance, setTargetBalance] = useState('')
  const [adjustDate, setAdjustDate] = useState(todayISO())
  const [adjustDesc, setAdjustDesc] = useState('')
  const [adjusting, setAdjusting] = useState(false)
  const [adjustMsg, setAdjustMsg] = useState<string | null>(null)

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

  async function handleAdjust() {
    const parsed = buildAdjustPayload(targetBalance, adjustDate, adjustDesc)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }

    setAdjusting(true)
    setError(null)
    setAdjustMsg(null)
    try {
      const res = await fetch('/api/cash/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.payload),
      })
      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setError(data?.error || 'No se pudo ajustar el saldo')
        return
      }

      setAdjustMsg(
        data?.adjusted
          ? `Ajuste registrado: ${formatUSD(data.delta)}`
          : 'El saldo ya coincidía — no se registró ningún movimiento'
      )
      setTargetBalance('')
      setAdjustDesc('')
      await fetchMovements()
      onMovementDeleted?.()
    } catch (err) {
      console.error('Error adjusting balance', err)
      setError('No se pudo ajustar el saldo')
    } finally {
      setAdjusting(false)
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
            <button
              onClick={() => { setShowAdjust(v => !v); setAdjustMsg(null) }}
              className="mt-1 inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 hover:text-slate-300 transition-colors"
            >
              <SlidersHorizontal className="w-3 h-3" />
              {showAdjust ? 'Cerrar' : 'Ajustar saldo'}
            </button>
          </div>
        </div>
      </div>

      {/* Balance reconciliation */}
      {showAdjust && (
        <div className="px-5 py-4 border-b border-white/[0.05] bg-white/[0.02]">
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Ingresá el saldo <strong className="text-slate-200">real</strong> de tu cuenta y se
            registra un único movimiento por la diferencia. No hace falta que recuerdes los
            depósitos viejos.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
            <label className="block">
              <span className="text-[10px] font-mono text-slate-500 uppercase">Saldo real</span>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={targetBalance}
                onChange={e => setTargetBalance(e.target.value)}
                placeholder="0.00"
                className="w-full mt-1 px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-white font-mono text-sm focus:outline-none focus:border-emerald/40"
              />
            </label>

            <label className="block">
              <span className="text-[10px] font-mono text-slate-500 uppercase">Fecha</span>
              <input
                type="date"
                value={adjustDate}
                onChange={e => setAdjustDate(e.target.value)}
                className="w-full mt-1 px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-white font-mono text-sm focus:outline-none focus:border-emerald/40"
              />
            </label>
          </div>

          <label className="block mt-2">
            <span className="text-[10px] font-mono text-slate-500 uppercase">Descripción (opcional)</span>
            <input
              type="text"
              maxLength={200}
              value={adjustDesc}
              onChange={e => setAdjustDesc(e.target.value)}
              placeholder="Saldo inicial del broker"
              className="w-full mt-1 px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-white font-mono text-sm focus:outline-none focus:border-emerald/40"
            />
          </label>

          <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
            Si estás corrigiendo un import, poné la fecha de tu primera operación: los movimientos
            anteriores al primer snapshot quedan fuera del Max Drawdown y no distorsionan la métrica.
          </p>

          {adjustMsg && (
            <div className="mt-3 px-3 py-2 bg-emerald/10 border border-emerald/20 rounded-lg text-emerald text-xs font-mono">
              {adjustMsg}
            </div>
          )}

          <button
            onClick={handleAdjust}
            disabled={adjusting}
            className="mt-3 w-full px-4 py-2 bg-emerald/15 hover:bg-emerald/25 disabled:opacity-40 disabled:cursor-not-allowed border border-emerald/25 rounded-lg text-emerald font-mono text-sm transition-colors"
          >
            {adjusting ? 'Ajustando…' : 'Registrar ajuste'}
          </button>
        </div>
      )}

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
              const isInflow = m.type === 'DEPOSITO' || m.type === 'CUPON' || m.type === 'DIVIDENDO' || m.type === 'VENTA'
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

                  {/* Delete button — only for MANUAL movements. A movement
                      generated by a transaction must be removed by deleting
                      the transaction itself (the API refuses it anyway). */}
                  {m.transaction_id ? (
                    <span
                      className="shrink-0 w-3.5 text-slate-800 select-none"
                      title="Generado por una transacción — eliminá la transacción para revertirlo"
                    />
                  ) : (
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
                  )}
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
