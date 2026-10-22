'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { StrategyWithSetups, IndicatorSetup, IndicatorParam } from '@/types'
import { StrategyFormModal } from '@/components/strategies/StrategyFormModal'
import { SetupFormModal } from '@/components/strategies/SetupFormModal'
import { Chip, SectionHead } from '@/components/resumen/ui'
import { ErrorNotice, SkeletonRows, ghostButton, iconButton, page, pageTitle, primaryButton, secondaryButton, textLink } from '@/components/strategies/ui'
import { formatNumber } from '@/lib/utils'

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
      return 'Volumen'
    default:
      return ind.type
  }
}

export default function StrategyDetailPage() {
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
      setError('No se pudo cargar la estrategia.')
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

  const back = (
    <Link href="/strategies" className={`${textLink} mb-2`}>
      <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
      Estrategias
    </Link>
  )

  if (loading) {
    return <div className={page}>{back}<SkeletonRows label="Cargando la estrategia" /></div>
  }

  if (notFound) {
    return (
      <div className={page}>
        {back}
        <h1 className={pageTitle}>Estrategia no encontrada</h1>
        <p className="mt-1 text-ink-3">Puede que se haya eliminado. Volvé al listado para elegir otra.</p>
      </div>
    )
  }

  if (error) {
    return <div className={page}>{back}<ErrorNotice onRetry={loadStrategy}>{error}</ErrorNotice></div>
  }

  if (!strategy) return null

  const meta = [
    strategy.timeframes.length > 0 ? `Timeframes ${strategy.timeframes.join(', ')}` : null,
    strategy.tickers.length > 0 ? strategy.tickers.join(', ') : 'Sin tickers',
  ].filter(Boolean).join(' · ')

  return (
    <div className={page}>
      {back}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className={`${pageTitle} min-w-0 break-words`}>{strategy.name}</h1>
            <Chip tone={strategy.active ? 'ok' : 'neutral'}>{strategy.active ? 'Activa' : 'Inactiva'}</Chip>
          </div>
          <p className="mt-1 text-ink-3">{meta}</p>
        </div>
        <div className="flex gap-2 max-[819px]:w-full">
          <Link href={`/strategies/${strategy.id}/performance`} className={`${secondaryButton} max-[819px]:flex-1`}>
            Ver rendimiento
          </Link>
          <button type="button" className={`${secondaryButton} max-[819px]:flex-1`} onClick={() => setShowEditStrategy(true)}>
            <Pencil className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            Editar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-10 max-[1080px]:grid-cols-[minmax(0,1fr)]">
        <section aria-labelledby="h-filosofia">
          <SectionHead id="h-filosofia" title="Filosofía" />
          <p className="whitespace-pre-wrap break-words pt-3 leading-relaxed text-ink-2">{strategy.philosophy}</p>
        </section>

        <section aria-labelledby="h-setups">
          <SectionHead
            id="h-setups"
            title="Setups"
            count={strategy.indicator_setups.length}
            action={
              <button type="button" className={textLink} onClick={openNewSetup}>
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                Nuevo setup
              </button>
            }
          />

          {strategy.indicator_setups.length === 0 ? (
            <div className="grid justify-items-start gap-3 py-6">
              <p className="text-ink-2">Esta estrategia todavía no tiene setups.</p>
              <button type="button" className={primaryButton} onClick={openNewSetup}>Crear el primer setup</button>
            </div>
          ) : (
            <ul>
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
            </ul>
          )}
        </section>
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
  const { indicators, stopLoss, takeProfit } = setup.config
  const risk = [
    stopLoss !== undefined ? `Stop loss ${formatNumber(stopLoss, { decimals: 1 })} %` : null,
    takeProfit !== undefined ? `Take profit ${formatNumber(takeProfit, { decimals: 1 })} %` : null,
  ].filter(Boolean).join(' · ')

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-line py-3 last:border-b-0 max-[819px]:grid-cols-[minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 break-words font-semibold">{setup.name}</span>
          <Chip tone={setup.active ? 'ok' : 'neutral'}>{setup.active ? 'Activo' : 'Inactivo'}</Chip>
        </div>
        {indicators.length > 0 && <p className="mt-0.5 text-[13px] text-ink-2">{indicators.map(indicatorLabel).join(' · ')}</p>}
        {risk && <p className="text-[13px] text-ink-3">{risk}</p>}
      </div>

      <div className="flex items-center gap-1 max-[819px]:-ml-3">
        <button
          type="button"
          className={ghostButton}
          onClick={() => onToggle(setup)}
          disabled={isToggling}
          aria-busy={isToggling}
          aria-label={`${setup.active ? 'Desactivar' : 'Activar'} ${setup.name}`}
        >
          {setup.active ? 'Desactivar' : 'Activar'}
        </button>
        <button type="button" className={iconButton} onClick={() => onEdit(setup)} aria-label={`Editar ${setup.name}`} title="Editar">
          <Pencil className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`${iconButton} hover:text-danger`}
          onClick={() => onDelete(setup.id)}
          disabled={isDeleting}
          aria-busy={isDeleting}
          aria-label={`Eliminar ${setup.name}`}
          title="Eliminar"
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    </li>
  )
}
