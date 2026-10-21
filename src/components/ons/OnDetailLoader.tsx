'use client'

import { useCallback, useEffect, useState } from 'react'
import OnDetail from './OnDetail'
import OnNotFound from './OnNotFound'
import type { OnAnalysis } from '@/lib/on-analytics'
import type { PricePoint } from '@/lib/on-catalog'

interface DetailResponse {
  analysis: OnAnalysis
  history: PricePoint[]
  asOf: string | null
  stale: boolean
  prices: { ok: boolean; fetchedAt: string | null }
}

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'missing' } | { kind: 'ok'; data: DetailResponse }

export default function OnDetailLoader({ isin }: { isin: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' })

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const res = await fetch(`/api/ons/${encodeURIComponent(isin)}`)
      if (res.status === 404 || res.status === 400) return setState({ kind: 'missing' })
      if (!res.ok) throw new Error(String(res.status))
      setState({ kind: 'ok', data: await res.json() })
    } catch {
      setState({ kind: 'error' })
    }
  }, [isin])
  useEffect(() => { void load() }, [load])

  if (state.kind === 'missing') return <OnNotFound />
  if (state.kind === 'error') {
    return (
      <div className="glass flex flex-col items-start gap-3 rounded-2xl p-6" role="alert">
        <p className="text-sm text-rose">No se pudo cargar la ON.</p>
        <button type="button" className="btn-ghost" onClick={() => void load()}>Reintentar</button>
      </div>
    )
  }
  if (state.kind === 'loading') {
    return <div className="glass flex items-center justify-center rounded-2xl p-10"><div role="status" aria-label="Cargando ON" className="h-6 w-6 animate-spin rounded-full border-2 border-amber/30 border-t-amber" /></div>
  }
  const { analysis, history, asOf, stale, prices } = state.data
  return <OnDetail analysis={analysis} history={history} asOf={asOf} stale={stale} prices={prices} />
}
