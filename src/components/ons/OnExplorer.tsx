'use client'

import { useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import OnExplorerFilters from './OnExplorerFilters'
import OnExplorerTable, { SortSelect } from './OnExplorerTable'
import type { OnListRow } from '@/lib/on-analytics'
import { applyExplorer, DEFAULT_STATE, issuersOf, parseExplorerQuery, serializeExplorerQuery, type ExplorerFilters, type SortKey } from '@/lib/on-explorer-filters'
import { fmtDate } from '@/lib/on-format'
import { argentinaDate, cn, formatAge } from '@/lib/utils'
import { useCached } from '@/lib/client-cache'
import { Disclosure, Glossary, Loading, LoadError, Notice, btnQuiet, btnSecondary, notice, type GlossaryTerm } from './ui'

interface CatalogResponse {
  rows: OnListRow[]
  asOf: string | null
  stale: boolean
  prices: { ok: boolean; quiet?: boolean; fetchedAt: string | null }
}

const PAGE_SIZE = 100
const GLOSSARY: GlossaryTerm[] = ['TIR', 'Precio sucio y limpio', 'Valor nominal (VN)', 'Plaza de pago', 'Ley', 'Tipo de tasa', 'Duración', 'Paridad', 'Tasa corriente', 'Vida promedio', 'Spread']

/** odd/tasks/ux-ons-y-operaciones.md S4: every condition of the data in one line, never a stack of boxes. */
export function DataStatus({ data }: { data: Pick<CatalogResponse, 'asOf' | 'stale' | 'prices'> }) {
  const parts = [
    data.stale && `Catálogo desactualizado: datos de BYMA Educa del ${fmtDate(data.asOf)}`,
    !data.prices.ok && 'Sin precios por ahora: no se calculan TIR ni duración',
    data.prices.ok && data.prices.quiet && 'Todavía no hubo operaciones hoy: precios de la última rueda',
  ].filter(Boolean)
  if (parts.length === 0) return null
  const warn = data.stale || !data.prices.ok
  return <p role="status" className={cn(notice(warn ? 'warn' : 'info'), 'py-2 text-[13px]')}>{parts.join(' · ')}.</p>
}

export default function OnExplorer() {
  const pathname = usePathname()
  const params = useSearchParams()
  // The catalog seen before in this tab shows at once and refreshes behind; the test portfolio shares it (odd/tasks/rendimiento.md S9).
  const catalog = useCached('ons:catalog', async (): Promise<CatalogResponse> => {
    const res = await fetch('/api/ons')
    if (!res.ok) throw new Error(String(res.status))
    return res.json()
  })
  const data = catalog.data ?? null
  const [shown, setShown] = useState(PAGE_SIZE)
  const [moreColumns, setMoreColumns] = useState(false)

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
  const onSort = (key: SortKey, dir?: 'asc' | 'desc') =>
    push({
      ...state,
      sort: dir ? { key, dir }
        : state.sort.key === key ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' }
          : { key, dir: key === 'ticker' || key === 'issuer' || key === 'maturity' ? 'asc' : 'desc' },
    })

  const rows = useMemo(() => data?.rows ?? [], [data])
  const filtered = useMemo(() => applyExplorer(rows, state), [rows, state])
  const issuers = useMemo(() => issuersOf(rows), [rows])
  const currencies = useMemo(() => [...new Set(rows.map((r) => r.currencyLabel))].sort(), [rows])

  if (!data && catalog.error) return <LoadError message="No se pudo cargar el catálogo de ONs." onRetry={catalog.reload} />
  if (!data) return <Loading label="Cargando ONs" />
  if (rows.length === 0) {
    return <Notice tone="info">El catálogo de ONs todavía no tiene datos. Se actualiza cada noche desde BYMA Educa; volvé a probar mañana.</Notice>
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <OnExplorerFilters filters={state.filters} issuers={issuers} currencies={currencies} today={argentinaDate()} resultCount={filtered.length}
        onChange={onChange} onReset={() => push({ ...state, filters: DEFAULT_STATE.filters })} />
      <DataStatus data={data} />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-[13px] text-ink-3 tabular-nums" aria-live="polite">{filtered.length} de {rows.length} ONs</p>
        <SortSelect sort={state.sort} onSort={onSort} className="min-[1080px]:hidden max-[1079px]:w-full" />
        <button type="button" aria-pressed={moreColumns} onClick={() => setMoreColumns((m) => !m)} className={cn(btnQuiet, 'max-[1079px]:hidden')}>
          {moreColumns ? 'Menos columnas' : 'Más columnas'}
        </button>
      </div>
      <OnExplorerTable rows={filtered.slice(0, shown)} sort={state.sort} onSort={onSort} moreColumns={moreColumns} />
      {filtered.length > shown && (
        <button type="button" className={`${btnSecondary} w-full`} onClick={() => setShown((s) => s + PAGE_SIZE)}>
          Mostrar {Math.min(PAGE_SIZE, filtered.length - shown)} más ({filtered.length - shown} restantes)
        </button>
      )}
      <div className="mt-4">
        <Disclosure title="Fuentes de los datos" summary={`BYMA Educa (datos al ${fmtDate(data.asOf)}) y data912`}>
          <div className="grid max-w-[80ch] gap-3 text-ink-2">
            <p>
              Términos y TIR de referencia: BYMA Educa, datos al {fmtDate(data.asOf)}. Precios: data912{data.prices.fetchedAt ? ` (${formatAge(data.prices.fetchedAt)})` : ''}, precio
              sucio cada 100 de valor nominal. TIR, duración, paridad, tasa corriente, vida promedio y spread: cálculo
              propio de Warren sobre el precio sucio. Volumen: promedio diario de las últimas 20 ruedas, en USD.
            </p>
            <p>Las notas debajo de la TIR avisan que conviene mirarla con cuidado; el detalle de cada ON explica el motivo:</p>
            <ul className="grid list-disc gap-1 pl-5">
              <li><strong className="font-medium text-ink">sin operaciones en la rueda</strong>: el precio es de referencia y la TIR no sería representativa.</li>
              <li><strong className="font-medium text-ink">tasa variable</strong>: el cupón depende de una tasa futura, así que no se calcula TIR.</li>
              <li><strong className="font-medium text-ink">difiere de BYMA</strong>: el cálculo de Warren y el de BYMA no coinciden; ninguno es definitivo.</li>
              <li><strong className="font-medium text-ink">vence en menos de 90 días</strong>: con tan poco plazo, la TIR cambia mucho con el precio.</li>
            </ul>
            <p>Informativo, no es una recomendación de inversión.</p>
          </div>
        </Disclosure>
        <Glossary terms={GLOSSARY} />
      </div>
    </div>
  )
}
