'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Pencil, Trash2, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import type { StrategyWithSetups, IndicatorSetup, IndicatorParam } from '@/types'
import { StrategyFormModal } from '@/components/strategies/StrategyFormModal'
import { SetupFormModal } from '@/components/strategies/SetupFormModal'

function indicatorLabel(ind: IndicatorParam): string {
  switch (ind.type) {
    case 'EMA':
      return `EMA ${ind.period ?? ''}`
    case 'RSI':
      return `RSI ${ind.period ?? ''}`
    case 'MACD':
      return `MACD ${ind.fast ?? ''}-${ind.slow ?? ''}-${ind.signal ?? ''}`
    case 'Bollinger':
      return `BB ${ind.period ?? ''}`
    case 'Volume':
      return 'Volume'
    default:
      return ind.type
  }
}

export default function StrategyDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const strategyId = params.id

  const [strategy, setStrategy] = useState<StrategyWithSetups | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  const [showEditStrategy, setShowEditStrategy] = useState(false)
  const [showSetupModal, setShowSetupModal] = useState(false)
  const [editingSetup, setEditingSetup] = useState<IndicatorSetup | undefined>(undefined)
  const [deletingSetupId, setDeletingSetupId] = useState<string | null>(null)
  const [togglingSetupId, setTogglingSetupId] = useState<string | null>(null)

  const loadStrategy = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/strategies/${strategyId}`)
      if (res.status === 404) {
        setNotFound(true)
        return
      }
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json() as { strategy: StrategyWithSetups }
      setStrategy(data.strategy)
    } catch {
      setError('No se pudo cargar la estrategia')
    } finally {
      setLoading(false)
    }
  }, [strategyId])

  useEffect(() => { loadStrategy() }, [loadStrategy])

  async function toggleSetupActive(setup: IndicatorSetup) {
    if (togglingSetupId) return
    setTogglingSetupId(setup.id)
    try {
      const res = await fetch(`/api/strategies/${strategyId}/setups/${setup.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !setup.active }),
      })
      if (!res.ok) throw new Error('Error al actualizar')
      const data = await res.json() as { setup: IndicatorSetup }
      setStrategy((prev) =>
        prev
          ? {
              ...prev,
              indicator_setups: prev.indicator_setups.map((s) =>
                s.id === setup.id ? data.setup : s
              ),
            }
          : prev
      )
      toast.success(data.setup.active ? 'Setup activado' : 'Setup desactivado')
    } catch {
      toast.error('No se pudo actualizar el setup')
    } finally {
      setTogglingSetupId(null)
    }
  }

  async function deleteSetup(setupId: string) {
    const confirmed = window.confirm('¿Eliminar este setup? Esta acción no se puede deshacer.')
    if (!confirmed) return
    setDeletingSetupId(setupId)
    try {
      const res = await fetch(`/api/strategies/${strategyId}/setups/${setupId}`, {
        method: 'DELETE',
      })
      if (!res.ok && res.status !== 204) throw new Error('Error al eliminar')
      setStrategy((prev) =>
        prev
          ? {
              ...prev,
              indicator_setups: prev.indicator_setups.filter((s) => s.id !== setupId),
            }
          : prev
      )
      toast.success('Setup eliminado')
    } catch {
      toast.error('No se pudo eliminar el setup')
    } finally {
      setDeletingSetupId(null)
    }
  }

  function openNewSetup() {
    setEditingSetup(undefined)
    setShowSetupModal(true)
  }

  function openEditSetup(setup: IndicatorSetup) {
    setEditingSetup(setup)
    setShowSetupModal(true)
  }

  function handleSetupSuccess(saved: IndicatorSetup) {
    setStrategy((prev) => {
      if (!prev) return prev
      const exists = prev.indicator_setups.some((s) => s.id === saved.id)
      return {
        ...prev,
        indicator_setups: exists
          ? prev.indicator_setups.map((s) => (s.id === saved.id ? saved : s))
          : [...prev.indicator_setups, saved],
      }
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen md:pl-56 pb-20 md:pb-0 p-6 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-amber border-t-transparent animate-spin" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="min-h-screen md:pl-56 pb-20 md:pb-0 p-6 flex flex-col items-center justify-center gap-4">
        <p className="text-slate-300 font-display font-600 text-lg">Estrategia no encontrada</p>
        <Link href="/strategies" className="btn-ghost text-xs inline-flex items-center gap-1.5">
          <ArrowLeft className="w-3.5 h-3.5" />
          Volver a estrategias
        </Link>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen md:pl-56 pb-20 md:pb-0 p-6 flex flex-col items-center justify-center gap-4">
        <p className="text-slate-400 font-mono text-sm">{error}</p>
        <button onClick={loadStrategy} className="btn-ghost text-xs">
          Reintentar
        </button>
      </div>
    )
  }

  if (!strategy) return null

  return (
    <div className="min-h-screen md:pl-56 pb-20 md:pb-0 p-6">
      <div className="max-w-[1550px] mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8 animate-fade-in">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="btn-ghost p-1.5 rounded-lg"
              aria-label="Volver"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display font-800 text-2xl md:text-3xl text-white tracking-tight">
                  {strategy.name}
                </h1>
                <span
                  className={
                    strategy.active
                      ? 'tag-positive text-[11px]'
                      : 'tag-neutral text-[11px]'
                  }
                >
                  {strategy.active ? 'Activa' : 'Inactiva'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {strategy.timeframes.map((tf) => (
                  <span
                    key={tf}
                    className="px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-300 text-[11px] font-mono border border-white/[0.08]"
                  >
                    {tf}
                  </span>
                ))}
                {strategy.tickers.map((ticker) => (
                  <span
                    key={ticker}
                    className="px-2 py-0.5 rounded-full bg-bg-800 text-slate-400 text-[11px] font-mono border border-white/[0.06]"
                  >
                    {ticker}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <button
            className="btn-ghost inline-flex items-center gap-1.5 text-xs shrink-0"
            onClick={() => setShowEditStrategy(true)}
          >
            <Pencil className="w-3.5 h-3.5" />
            Editar estrategia
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Left column: Philosophy + Performance */}
          <div className="flex flex-col gap-6">

            {/* Philosophy */}
            <section className="glass rounded-2xl p-5 border border-white/[0.08]">
              <h2 className="font-display font-700 text-white text-sm mb-3">Filosofía</h2>
              <pre className="text-slate-300 text-sm font-mono whitespace-pre-wrap leading-relaxed">
                {strategy.philosophy}
              </pre>
            </section>

            {/* Performance placeholder */}
            <section className="glass rounded-2xl p-5 border border-white/[0.08]">
              <h2 className="font-display font-700 text-white text-sm mb-3">Performance</h2>
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <p className="text-slate-500 font-mono text-xs text-center">
                  Disponible en Sprint 5
                </p>
                <ChevronRight className="w-4 h-4 text-slate-600" />
              </div>
            </section>

          </div>

          {/* Right column: Setups */}
          <div className="lg:col-span-2">
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display font-700 text-white text-sm">
                  Setups
                  <span className="ml-2 text-slate-500 font-mono text-xs">
                    ({strategy.indicator_setups.length})
                  </span>
                </h2>
                <button
                  className="btn-primary inline-flex items-center gap-1.5 text-xs"
                  onClick={openNewSetup}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Nuevo setup
                </button>
              </div>

              {strategy.indicator_setups.length === 0 ? (
                <div className="glass rounded-2xl p-8 border border-white/[0.08] flex flex-col items-center gap-3">
                  <p className="text-slate-400 font-mono text-sm">Sin setups todavía</p>
                  <button
                    className="btn-primary inline-flex items-center gap-1.5 text-xs"
                    onClick={openNewSetup}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Crear primer setup
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {strategy.indicator_setups.map((setup) => (
                    <SetupRow
                      key={setup.id}
                      setup={setup}
                      togglingId={togglingSetupId}
                      deletingId={deletingSetupId}
                      onToggle={toggleSetupActive}
                      onEdit={openEditSetup}
                      onDelete={deleteSetup}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>

        </div>
      </div>

      <StrategyFormModal
        open={showEditStrategy}
        onOpenChange={setShowEditStrategy}
        strategy={strategy}
        onSuccess={(s) => setStrategy((prev) => prev ? { ...prev, ...s } : prev)}
      />

      <SetupFormModal
        open={showSetupModal}
        onOpenChange={setShowSetupModal}
        strategyId={strategyId}
        setup={editingSetup}
        onSuccess={handleSetupSuccess}
      />
    </div>
  )
}

function SetupRow({
  setup,
  togglingId,
  deletingId,
  onToggle,
  onEdit,
  onDelete,
}: {
  setup: IndicatorSetup
  togglingId: string | null
  deletingId: string | null
  onToggle: (setup: IndicatorSetup) => void
  onEdit: (setup: IndicatorSetup) => void
  onDelete: (id: string) => void
}) {
  const isToggling = togglingId === setup.id
  const isDeleting = deletingId === setup.id

  return (
    <div className="glass rounded-xl p-4 border border-white/[0.08] flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-display font-600 text-white text-sm truncate">{setup.name}</span>
          <span
            className={
              setup.active
                ? 'tag-positive text-[10px] shrink-0'
                : 'tag-neutral text-[10px] shrink-0'
            }
          >
            {setup.active ? 'activo' : 'inactivo'}
          </span>
        </div>

        {setup.config.indicators.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {setup.config.indicators.map((ind, i) => (
              <span
                key={i}
                className="px-2 py-0.5 rounded-full bg-amber/10 text-amber text-[11px] font-mono border border-amber/20"
              >
                {indicatorLabel(ind)}
              </span>
            ))}
          </div>
        )}

        {(setup.config.stopLoss !== undefined || setup.config.takeProfit !== undefined) && (
          <div className="flex gap-3 mt-2">
            {setup.config.stopLoss !== undefined && (
              <span className="text-[11px] font-mono text-slate-500">
                SL {setup.config.stopLoss}%
              </span>
            )}
            {setup.config.takeProfit !== undefined && (
              <span className="text-[11px] font-mono text-slate-500">
                TP {setup.config.takeProfit}%
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* Toggle active */}
        <button
          className={`btn-ghost text-xs px-2.5 py-1 ${isToggling ? 'opacity-50 cursor-not-allowed' : ''}`}
          onClick={() => !isToggling && onToggle(setup)}
          disabled={isToggling}
          title={setup.active ? 'Desactivar' : 'Activar'}
        >
          {isToggling ? (
            <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin inline-block" />
          ) : (
            <span className="text-[11px]">{setup.active ? 'Desactivar' : 'Activar'}</span>
          )}
        </button>

        {/* Edit */}
        <button
          className="btn-ghost p-1.5"
          onClick={() => onEdit(setup)}
          title="Editar setup"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>

        {/* Delete */}
        <button
          className={`btn-ghost p-1.5 text-red-400 hover:text-red-300 ${isDeleting ? 'opacity-50 cursor-not-allowed' : ''}`}
          onClick={() => !isDeleting && onDelete(setup.id)}
          disabled={isDeleting}
          title="Eliminar setup"
        >
          {isDeleting ? (
            <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin inline-block" />
          ) : (
            <Trash2 className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  )
}
