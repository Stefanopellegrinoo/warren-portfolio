'use client'

import { useCached } from '@/lib/client-cache'
import OnDetail from './OnDetail'
import OnNotFound from './OnNotFound'
import type { OnAnalysis } from '@/lib/on-analytics'
import type { PricePoint } from '@/lib/on-catalog'
import { Loading, LoadError } from './ui'

interface DetailResponse {
  analysis: OnAnalysis
  history: PricePoint[]
  asOf: string | null
  stale: boolean
  prices: { ok: boolean; fetchedAt: string | null }
}

const MISSING = 'missing'

export default function OnDetailLoader({ isin }: { isin: string }) {
  // An ON seen before in this tab shows at once and refreshes behind (odd/tasks/rendimiento.md S9).
  const { data, error, reload } = useCached(`ons:detail:${isin}`, async (): Promise<DetailResponse> => {
    const res = await fetch(`/api/ons/${encodeURIComponent(isin)}`)
    if (res.status === 404 || res.status === 400) throw new Error(MISSING)
    if (!res.ok) throw new Error(String(res.status))
    return res.json()
  })

  if (error instanceof Error && error.message === MISSING) return <OnNotFound />
  if (!data) return error ? <LoadError message="No se pudo cargar la ON." onRetry={reload} /> : <Loading label="Cargando ON" />
  const { analysis, history, asOf, stale, prices } = data
  return <OnDetail analysis={analysis} history={history} asOf={asOf} stale={stale} prices={prices} />
}
