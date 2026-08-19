'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, BookOpen } from 'lucide-react'
import type { StrategyWithSetups, StrategiesListResponse } from '@/types'
import { StrategyFormModal } from '@/components/strategies/StrategyFormModal'
import { PriceAlertsTab } from '@/components/strategies/PriceAlertsTab'

export default function StrategiesPage() {
  return (
    <Suspense>
      <StrategiesContent />
    </Suspense>
  )
}

function StrategiesContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeTab = (searchParams.get('tab') === 'alertas' ? 'alertas' : 'estrategias') as 'estrategias' | 'alertas'

  const [strategies, setStrategies] = useState<StrategyWithSetups[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)

  const loadStrategies = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/strategies')
      if (!res.ok) throw new Error('Failed to load')
      const data: StrategiesListResponse = await res.json()
      setStrategies(data.strategies)
    } catch {
      setError('No se pudieron cargar las estrategias')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadStrategies() }, [loadStrategies])

  function setTab(tab: 'estrategias' | 'alertas') {
    const params = new URLSearchParams(searchParams.toString())
    if (tab === 'alertas') {
      params.set('tab', 'alertas')
    } else {
      params.delete('tab')
    }
    router.push(`/strategies?${params.toString()}`)
  }

  return (
    <div className="min-h-screen md:pl-56 pb-20 md:pb-0 p-6">
      <div className="max-w-[1550px] mx-auto">

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 animate-fade-in">
          <div>
            <h1 className="font-display font-800 text-2xl md:text-3xl text-white tracking-tight">
              Estrategias
            </h1>
            <p className="text-slate-400 font-mono text-sm mt-1">
              Gestioná tus estrategias e indicadores
            </p>
          </div>
          {activeTab === 'estrategias' && (
            <button
              className="btn-primary inline-flex items-center gap-2 text-xs"
              onClick={() => setShowModal(true)}
            >
              <Plus className="w-4 h-4" />
              Nueva estrategia
            </button>
          )}
        </div>

        {/* Tab strip */}
        <div className="flex gap-0 mb-6 border-b border-white/[0.08]">
          {(['estrategias', 'alertas'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setTab(tab)}
              className={`px-4 py-2 text-xs font-mono border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-amber text-amber'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab === 'estrategias' ? 'Estrategias' : 'Alertas'}
            </button>
          ))}
        </div>

        {/* Estrategias tab */}
        {activeTab === 'estrategias' && (
          <>
            {loading && (
              <div className="flex items-center justify-center py-24">
                <div className="w-8 h-8 rounded-full border-2 border-amber border-t-transparent animate-spin" />
              </div>
            )}

            {!loading && error && (
              <div className="flex flex-col items-center justify-center py-24 gap-4">
                <p className="text-slate-400 font-mono text-sm">{error}</p>
                <button onClick={loadStrategies} className="btn-ghost text-xs">
                  Reintentar
                </button>
              </div>
            )}

            {!loading && !error && strategies.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 gap-4 animate-fade-in">
                <div className="w-14 h-14 rounded-2xl bg-amber/10 flex items-center justify-center">
                  <BookOpen className="w-7 h-7 text-amber" />
                </div>
                <div className="text-center">
                  <p className="text-white font-display font-600 text-lg">Sin estrategias todavía</p>
                  <p className="text-slate-400 font-mono text-sm mt-1">Creá tu primera estrategia para empezar a trackear setups</p>
                </div>
                <button
                  className="btn-primary inline-flex items-center gap-2 text-xs"
                  onClick={() => setShowModal(true)}
                >
                  <Plus className="w-4 h-4" />
                  Crear primera estrategia
                </button>
              </div>
            )}

            {!loading && !error && strategies.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
                {strategies.map((strategy) => (
                  <StrategyCard
                    key={strategy.id}
                    strategy={strategy}
                    onViewDetail={() => router.push(`/strategies/${strategy.id}`)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Alertas tab */}
        {activeTab === 'alertas' && (
          <PriceAlertsTab />
        )}

      </div>

      <StrategyFormModal
        open={showModal}
        onOpenChange={setShowModal}
        onSuccess={(s) => setStrategies((prev) => {
          const exists = prev.some((p) => p.id === s.id)
          if (exists) return prev.map((p) => p.id === s.id ? { ...p, ...s } : p)
          return [{ ...s, indicator_setups: [] }, ...prev]
        })}
      />
    </div>
  )
}

function StrategyCard({
  strategy,
  onViewDetail,
}: {
  strategy: StrategyWithSetups
  onViewDetail: () => void
}) {
  const activeSetups = strategy.indicator_setups.filter((s) => s.active)

  return (
    <div className="kpi-card rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-display font-700 text-white text-base leading-snug">{strategy.name}</h2>
        <span
          className={
            strategy.active
              ? 'tag-positive shrink-0 text-[11px]'
              : 'tag-neutral shrink-0 text-[11px]'
          }
        >
          {strategy.active ? 'Activa' : 'Inactiva'}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="px-2 py-0.5 rounded-full bg-amber/10 text-amber text-[11px] font-mono border border-amber/20">
          {activeSetups.length} {activeSetups.length === 1 ? 'setup' : 'setups'}
        </span>
        {strategy.timeframes.map((tf) => (
          <span
            key={tf}
            className="px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-300 text-[11px] font-mono border border-white/[0.08]"
          >
            {tf}
          </span>
        ))}
      </div>

      {strategy.tickers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {strategy.tickers.map((ticker) => (
            <span
              key={ticker}
              className="px-2 py-0.5 rounded-full bg-bg-800 text-slate-400 text-[11px] font-mono border border-white/[0.06]"
            >
              {ticker}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto pt-3 border-t border-white/[0.05]">
        <button onClick={onViewDetail} className="btn-ghost w-full justify-center text-xs">
          Ver detalle
        </button>
      </div>
    </div>
  )
}
