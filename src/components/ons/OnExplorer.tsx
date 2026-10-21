'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import OnExplorerFilters from './OnExplorerFilters'
import OnExplorerTable from './OnExplorerTable'
import type { OnListRow } from '@/lib/on-analytics'
import { applyExplorer, DEFAULT_STATE, issuersOf, parseExplorerQuery, serializeExplorerQuery, type ExplorerFilters, type SortKey } from '@/lib/on-explorer-filters'
import { fmtDate } from '@/lib/on-format'
import { formatAge } from '@/lib/utils'

interface CatalogResponse {
  rows: OnListRow[]
  asOf: string | null
  stale: boolean
  prices: { ok: boolean; quiet?: boolean; fetchedAt: string | null }
}

const PAGE_SIZE = 100

function Banner({ tone, children }: { tone: 'warn' | 'info'; children: React.ReactNode }) {
  const cls = tone === 'warn' ? 'border-amber/30 bg-amber/10 text-amber' : 'border-slate-500/30 bg-slate-500/10 text-slate-300'
  return <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>
}

export default function OnExplorer() {
  const pathname = usePathname()
  const params = useSearchParams()
  const [data, setData] = useState<CatalogResponse | null>(null)
  const [error, setError] = useState(false)
  const [shown, setShown] = useState(PAGE_SIZE)

  const load = useCallback(async () => {
    setError(false)
    try {
      const res = await fetch('/api/ons')
      if (!res.ok) throw new Error(String(res.status))
      setData(await res.json())
    } catch {
      setError(true)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  // Local state drives the controls (typing must never wait on the router); the URL mirrors it
  // so a view can be shared or reloaded. It is read once, on mount.
  const [state, setState] = useState(() => parseExplorerQuery(params))
  const push = (next: typeof state) => {
    setState(next)
    const qs = serializeExplorerQuery(next)
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname)
    setShown(PAGE_SIZE)
  }
  const onChange = (patch: Partial<ExplorerFilters>) => push({ ...state, filters: { ...state.filters, ...patch } })
  const onSort = (key: SortKey) =>
    push({ ...state, sort: state.sort.key === key ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'ticker' || key === 'issuer' || key === 'maturity' ? 'asc' : 'desc' } })

  const rows = useMemo(() => data?.rows ?? [], [data])
  const filtered = useMemo(() => applyExplorer(rows, state), [rows, state])
  const issuers = useMemo(() => issuersOf(rows), [rows])
  const currencies = useMemo(() => [...new Set(rows.map((r) => r.currencyLabel))].sort(), [rows])

  if (error) {
    return (
      <div className="glass flex flex-col items-start gap-3 rounded-2xl p-6" role="alert">
        <p className="text-sm text-rose">No se pudo cargar el catálogo de ONs.</p>
        <button type="button" className="btn-ghost" onClick={() => void load()}>Reintentar</button>
      </div>
    )
  }
  if (!data) {
    return <div className="glass flex items-center justify-center rounded-2xl p-10"><div role="status" aria-label="Cargando ONs" className="h-6 w-6 animate-spin rounded-full border-2 border-amber/30 border-t-amber" /></div>
  }

  return (
    <div className="space-y-4">
      {rows.length === 0 && (
        <Banner tone="info">El catálogo de ONs todavía no tiene datos. Se actualiza cada noche desde BYMA Educa; volvé a probar mañana.</Banner>
      )}
      {rows.length > 0 && data.stale && (
        <Banner tone="warn">Catálogo desactualizado: los datos de BYMA Educa son del {fmtDate(data.asOf)}.{data.prices.ok ? ' Los precios son los de hoy.' : ''}</Banner>
      )}
      {!data.prices.ok && rows.length > 0 && (
        <Banner tone="warn">Precios no disponibles en este momento (data912). Se muestran los términos sin TIR ni duración.</Banner>
      )}
      {rows.length > 0 && data.prices.ok && data.prices.quiet && (
        <Banner tone="info">Mercado sin operaciones aún hoy: se muestran los precios de la última rueda.</Banner>
      )}
      {rows.length > 0 && (
        <>
          <OnExplorerFilters filters={state.filters} issuers={issuers} currencies={currencies} onChange={onChange} onReset={() => push(DEFAULT_STATE)} />
          <p className="text-xs font-mono text-slate-400" aria-live="polite">{filtered.length} de {rows.length} ONs</p>
          <OnExplorerTable rows={filtered.slice(0, shown)} sort={state.sort} onSort={onSort} />
          {filtered.length > shown && (
            <button type="button" className="btn-ghost w-full" onClick={() => setShown((s) => s + PAGE_SIZE)}>
              Mostrar {Math.min(PAGE_SIZE, filtered.length - shown)} más ({filtered.length - shown} restantes)
            </button>
          )}
          <p className="text-[11px] font-mono leading-relaxed text-slate-500">
            Fuentes: términos y TIR de referencia de BYMA Educa (datos al {fmtDate(data.asOf)}); precios de data912
            {data.prices.fetchedAt ? ` (${formatAge(data.prices.fetchedAt)})` : ''}; TIR, duración, paridad, tasa corriente, vida promedio y spread: cálculo propio de Warren sobre precio sucio.
            Informativo, no es una recomendación de inversión.
          </p>
        </>
      )}
    </div>
  )
}
