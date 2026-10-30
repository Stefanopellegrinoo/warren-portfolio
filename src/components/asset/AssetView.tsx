'use client'

import { useState } from 'react'
import { useCached } from '@/lib/client-cache'
import { cn } from '@/lib/utils'
import { requestErrorMessage } from '@/lib/request-errors'
import { apiData, ApiFailure } from '@/components/ons/portfolios/api'
import { Loading, LoadError, Notice } from '@/components/ons/ui'
import { NumerosTab } from '@/components/asset/numeros/NumerosTab'
import type { AssetPage } from '@/lib/fundamentals/service'
import AssetHeader from './AssetHeader'

export interface AssetTab { id: string; label: string; content: React.ReactNode }

/** Resumen · Números · Comparar · Noticias, as each ships; a single tab needs no bar. */
export function AssetTabs({ tabs }: { tabs: AssetTab[] }) {
  const [current, setCurrent] = useState(tabs[0].id)
  const shown = tabs.find((t) => t.id === current) ?? tabs[0]
  if (tabs.length === 1) return <>{shown.content}</>

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    const next = tabs[(tabs.indexOf(shown) + step + tabs.length) % tabs.length]
    setCurrent(next.id)
    document.getElementById(`asset-tab-${next.id}`)?.focus()
  }

  return (
    <>
      <div role="tablist" aria-label="Secciones del activo" onKeyDown={onKeyDown} className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            id={`asset-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={t.id === shown.id}
            aria-controls="asset-tab-panel"
            tabIndex={t.id === shown.id ? 0 : -1}
            onClick={() => setCurrent(t.id)}
            className={cn(
              'relative inline-flex min-h-11 flex-none items-center whitespace-nowrap px-3 text-sm font-medium text-ink-2 hover:text-ink',
              t.id === shown.id && 'text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="asset-tab-panel" aria-labelledby={`asset-tab-${shown.id}`}>{shown.content}</div>
    </>
  )
}

/** Financial data means statements: an ETF today has a snapshot value or two (beta, shares) and none. */
const hasNumbers = (page: AssetPage) =>
  !!page.metrics && Object.values(page.metrics).some((m) => m.source !== 'snapshot' && m.today !== null)

function Body({ page, onRetry }: { page: AssetPage; onRetry: () => void }) {
  if (!page.supported) return <Notice tone="info">Todavía no tenemos datos financieros de este mercado.</Notice>
  if (hasNumbers(page)) return <AssetTabs tabs={[{ id: 'numeros', label: 'Números', content: <NumerosTab page={page} /> }]} />
  if (page.sources.tradingview === 'error') return <LoadError message="No pudimos traer los datos financieros de este activo." onRetry={onRetry} />
  return <Notice tone="info">Todavía no tenemos datos financieros de este activo.</Notice>
}

/** The asset page's content (odd/tasks/asset-page.md S1): one request to /api/asset/<ticker>, remembered in this tab. */
export default function AssetView({ ticker, vs }: { ticker: string; vs?: string }) {
  // An empty ?vs= is forwarded too: the API reads it as "no peers".
  const url = `/api/asset/${encodeURIComponent(ticker)}${vs === undefined ? '' : `?vs=${encodeURIComponent(vs)}`}`
  const { data, error, reload } = useCached(`asset:${url}`, () => apiData<AssetPage>(url))

  if (!data) {
    // 400 (not a ticker) and 404 (no such asset) carry the API's own message.
    if (error instanceof ApiFailure && (error.status === 400 || error.status === 404)) {
      return (
        <div role="alert" className="grid justify-items-start gap-2 py-8">
          <h1 className="break-all text-2xl font-semibold">{ticker}</h1>
          <p className="text-ink-2">{error.message}</p>
          <p className="text-ink-3">Probá encontrarlo con el buscador.</p>
        </div>
      )
    }
    if (error) return <LoadError message={requestErrorMessage(error, 'No se pudo cargar el activo.')} onRetry={reload} />
    return <Loading label={`Cargando ${ticker}`} />
  }

  return (
    <>
      <AssetHeader page={data} />
      <Body page={data} onRetry={reload} />
    </>
  )
}
