'use client'

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ChevronRight, Plus } from 'lucide-react'
import type { StrategyWithSetups, StrategiesListResponse } from '@/types'
import { StrategyFormModal } from '@/components/strategies/StrategyFormModal'
import { PriceAlertsTab } from '@/components/strategies/PriceAlertsTab'
import { Chip, SectionHead } from '@/components/resumen/ui'
import { ErrorNotice, SkeletonRows, page, pageTitle, primaryButton, tabClass } from '@/components/strategies/ui'
import { cachedValue, useCached } from '@/lib/client-cache'

export default function StrategiesPage() {
  return (
    <Suspense>
      <StrategiesContent />
    </Suspense>
  )
}

const LIST_KEY = 'strategies:list'

function StrategiesContent() {
  const searchParams = useSearchParams()
  const activeTab = searchParams.get('tab') === 'alertas' ? 'alertas' : 'estrategias'

  const [showModal, setShowModal] = useState(false)
  // Seen before in this tab, the list shows at once and refreshes behind (odd/tasks/rendimiento.md S9).
  const list = useCached(LIST_KEY, async () => {
    const res = await fetch('/api/strategies')
    if (!res.ok) throw new Error('Failed to load')
    const data: StrategiesListResponse = await res.json()
    return data.strategies
  })
  const strategies = list.data ?? []
  const loading = !list.data && list.loading
  const error = !list.data && list.error ? 'No se pudieron cargar las estrategias.' : null
  const loadStrategies = list.reload
  // From the latest remembered list, like a state updater, so a change never undoes one made meanwhile.
  const setStrategies = (update: (prev: StrategyWithSetups[]) => StrategyWithSetups[]) =>
    list.mutate(update(cachedValue<StrategyWithSetups[]>(LIST_KEY) ?? []))

  return (
    <div className={page}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className={pageTitle}>Estrategias y alertas</h1>
          <p className="mt-1 text-ink-3">Tus estrategias con sus setups de indicadores, y las alertas de precio que creaste en Gráficos.</p>
        </div>
        {activeTab === 'estrategias' && (
          <button type="button" className={`${primaryButton} max-[819px]:w-full`} onClick={() => setShowModal(true)}>
            <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            Nueva estrategia
          </button>
        )}
      </div>

      <nav aria-label="Secciones" className="mb-8 flex gap-6 border-b border-line">
        <Link href="/strategies" aria-current={activeTab === 'estrategias' ? 'page' : undefined} className={tabClass(activeTab === 'estrategias')}>
          Estrategias
        </Link>
        <Link href="/strategies?tab=alertas" aria-current={activeTab === 'alertas' ? 'page' : undefined} className={tabClass(activeTab === 'alertas')}>
          Alertas
        </Link>
      </nav>

      {activeTab === 'estrategias' && (
        <section aria-labelledby="h-estrategias">
          <SectionHead id="h-estrategias" title="Estrategias" count={loading || error ? undefined : strategies.length} />

          {loading && <SkeletonRows label="Cargando estrategias" />}

          {!loading && error && <div className="pt-3"><ErrorNotice onRetry={loadStrategies}>{error}</ErrorNotice></div>}

          {!loading && !error && strategies.length === 0 && (
            <div className="grid justify-items-start gap-3 py-8">
              <p className="text-ink-2">Todavía no tenés estrategias. Creá la primera para empezar a seguir setups.</p>
              <button type="button" className={primaryButton} onClick={() => setShowModal(true)}>
                Crear primera estrategia
              </button>
            </div>
          )}

          {!loading && !error && strategies.length > 0 && (
            <ul>
              {strategies.map((strategy) => <StrategyRow key={strategy.id} strategy={strategy} />)}
            </ul>
          )}
        </section>
      )}

      {activeTab === 'alertas' && <PriceAlertsTab />}

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

function StrategyRow({ strategy }: { strategy: StrategyWithSetups }) {
  const activeSetups = strategy.indicator_setups.filter((s) => s.active).length
  const meta = [
    `${activeSetups} ${activeSetups === 1 ? 'setup activo' : 'setups activos'}`,
    strategy.timeframes.length > 0 ? strategy.timeframes.join(', ') : null,
    strategy.tickers.length > 0 ? strategy.tickers.join(', ') : null,
  ].filter(Boolean).join(' · ')

  return (
    <li className="border-b border-line last:border-b-0">
      <Link
        href={`/strategies/${strategy.id}`}
        className="grid min-h-[60px] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-3 hover:bg-hover"
      >
        <span className="min-w-0">
          <span className="block font-semibold">{strategy.name}</span>
          <small className="block truncate text-[13px] text-ink-3">{meta}</small>
        </span>
        <Chip tone={strategy.active ? 'ok' : 'neutral'}>{strategy.active ? 'Activa' : 'Inactiva'}</Chip>
        <ChevronRight className="h-4 w-4 text-ink-3" strokeWidth={1.5} aria-hidden="true" />
      </Link>
    </li>
  )
}
