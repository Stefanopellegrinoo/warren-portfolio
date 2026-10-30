'use client'

import { useEffect, useState } from 'react'
import { useCached } from '@/lib/client-cache'
import { cn } from '@/lib/utils'
import { requestErrorMessage } from '@/lib/request-errors'
import { apiData, ApiFailure } from '@/components/ons/portfolios/api'
import { Loading, LoadError, Notice, notice as noticeBox } from '@/components/ons/ui'
import { NumerosTab } from '@/components/asset/numeros/NumerosTab'
import { ResumenTab } from '@/components/asset/resumen/ResumenTab'
import { ComparaTab } from '@/components/asset/comparar/ComparaTab'
import { NoticiasTab } from '@/components/asset/noticias/NoticiasTab'
import { CryptoResumen, FundResumen } from '@/components/asset/resumen/OtherResumen'
import { ComposicionTab } from '@/components/asset/composicion/ComposicionTab'
import type { AssetPage } from '@/lib/fundamentals/service'
import AssetHeader from './AssetHeader'

/** Opens a tab; with `dato`, Números' row of that metric, as a step the back button undoes. */
type OpenTab = (id: string, dato?: string) => void
export interface AssetTab { id: string; label: string; content: React.ReactNode | ((open: OpenTab) => React.ReactNode) }

/** ?tab= names the open tab, the first one when absent; ?dato= alone (Números' own links) means Números. */
function urlTab(ids: string[]): string {
  const q = new URLSearchParams(window.location.search)
  const t = q.get('tab') ?? (q.has('dato') ? 'numeros' : null)
  return t !== null && ids.includes(t) ? t : ids[0]
}

/** Resumen · Números · Comparar · Noticias; a single tab needs no bar. The open one lives in ?tab=, so a reload or back keeps it. */
export function AssetTabs({ tabs }: { tabs: AssetTab[] }) {
  const ids = tabs.map((t) => t.id)
  const key = ids.join(',')
  const [current, setCurrent] = useState(() => urlTab(ids))
  const shown = tabs.find((t) => t.id === current) ?? tabs[0]

  useEffect(() => {
    const read = () => setCurrent(urlTab(key.split(',')))
    window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [key])

  const open: OpenTab = (id, dato) => {
    const url = new URL(window.location.href)
    if (id === ids[0]) url.searchParams.delete('tab')
    else url.searchParams.set('tab', id)
    // A metric belongs to Números: leaving it closes the metric.
    if (dato) url.searchParams.set('dato', dato)
    else url.searchParams.delete('dato')
    if (dato) window.history.pushState(null, '', url)
    else window.history.replaceState(null, '', url)
    setCurrent(id)
  }

  const content = typeof shown.content === 'function' ? shown.content(open) : shown.content
  if (tabs.length === 1) return <>{content}</>

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    const next = tabs[(tabs.indexOf(shown) + step + tabs.length) % tabs.length]
    open(next.id)
    document.getElementById(`asset-tab-${next.id}`)?.focus()
  }

  return (
    <>
      {/* The four labels need 250 px at 15 px: under 420 px they share the width, so a 320 px phone shows them all. */}
      <div role="tablist" aria-label="Secciones del activo" onKeyDown={onKeyDown} className="mb-5 flex gap-1 overflow-x-auto border-b border-line max-[419px]:gap-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            id={`asset-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={t.id === shown.id}
            aria-controls="asset-tab-panel"
            tabIndex={t.id === shown.id ? 0 : -1}
            onClick={() => open(t.id)}
            className={cn(
              'relative inline-flex min-h-11 flex-none items-center justify-center whitespace-nowrap px-3 text-[15px] font-medium text-ink-2 hover:text-ink max-[419px]:flex-1 max-[419px]:px-1',
              t.id === shown.id && 'text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent max-[419px]:after:inset-x-1',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="asset-tab-panel" aria-labelledby={`asset-tab-${shown.id}`}>{content}</div>
    </>
  )
}

/** Financial data means statements: a snapshot value or two (beta, shares) or the analysts' target alone is none. */
const hasNumbers = (page: AssetPage) =>
  !!page.metrics && Object.values(page.metrics).some((m) => (m.source === 'tradingview' || m.source === 'yahoo') && m.today !== null)

function Body({ page, onRetry }: { page: AssetPage; onRetry: () => void }) {
  const news = { id: 'noticias', label: 'Noticias', content: <NoticiasTab ticker={page.ticker} name={page.name} /> }
  // Assets without a balance sheet get their own page (T10, design goal 9).
  if (page.kind === 'etf') {
    return (
      <AssetTabs
        tabs={[
          { id: 'resumen', label: 'Resumen', content: <FundResumen page={page} /> },
          { id: 'composicion', label: 'Composición', content: <ComposicionTab page={page} /> },
          news,
        ]}
      />
    )
  }
  if (page.kind === 'crypto') return <AssetTabs tabs={[{ id: 'resumen', label: 'Resumen', content: <CryptoResumen page={page} /> }, news]} />
  if (!page.supported) {
    // The shared Notice is 14 px; this one stands alone as a tab's content (L25: 15 px).
    const message = <div role="status" className={cn(noticeBox('info'), 'text-[15px]')}>Todavía no tenemos datos financieros de este mercado.</div>
    // Its news need a name to search by: Yahoo names an asset it has no name for by its symbol.
    return page.name === page.ticker ? message : <AssetTabs tabs={[{ id: 'resumen', label: 'Resumen', content: message }, news]} />
  }
  if (hasNumbers(page)) {
    return (
      <AssetTabs
        tabs={[
          { id: 'resumen', label: 'Resumen', content: (open) => <ResumenTab page={page} onOpen={(id) => open('numeros', id)} /> },
          { id: 'numeros', label: 'Números', content: <NumerosTab page={page} /> },
          { id: 'comparar', label: 'Comparar', content: <ComparaTab page={page} /> },
          news,
        ]}
      />
    )
  }
  if (page.sources.tradingview === 'error') return <LoadError message="No pudimos traer los datos financieros de este activo." onRetry={onRetry} />
  return <Notice tone="info">Todavía no tenemos datos financieros de este activo.</Notice>
}

/** The asset page's content (odd/tasks/asset-page.md S1): one request to /api/asset/<ticker>, remembered in this tab. */
export default function AssetView({ ticker, vs }: { ticker: string; vs?: string }) {
  // An empty ?vs= is forwarded too: the API reads it as "no peers".
  const url = `/api/asset/${encodeURIComponent(ticker)}${vs === undefined ? '' : `?vs=${encodeURIComponent(vs)}`}`
  const { data, error, reload } = useCached(`asset:${url}`, () => apiData<AssetPage>(url))
  // While a new ?vs= loads, the page it was edited on stays, on its tab: Comparar says it is updating (L29).
  const [kept, setKept] = useState<{ ticker: string; page: AssetPage } | null>(null)
  if (data && (kept?.page !== data || kept.ticker !== ticker)) setKept({ ticker, page: data })
  const page = data ?? (!error && kept?.ticker === ticker ? kept.page : undefined)

  if (!page) {
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
      <AssetHeader page={page} />
      <Body page={page} onRetry={reload} />
    </>
  )
}
