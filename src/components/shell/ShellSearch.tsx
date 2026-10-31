'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { cachedValue, load } from '@/lib/client-cache'
import { getPortfolio, POSITIONS_KEY } from '@/lib/warren/positions'
import { searchAssets, type CatalogEntry } from '@/lib/asset-search'
import { applyExplorer, DEFAULT_STATE } from '@/lib/on-explorer-filters'
import { requestErrorMessage } from '@/lib/request-errors'
import { fetchTickerSearch, shouldFetchSearch } from '@/components/trading/chart/ticker-search'
import type { OnListRow } from '@/lib/on-analytics'
import type { SearchResult } from '@/lib/market-data/types'
import { assetHref } from './nav'

interface Hit { key: string; ticker: string; name: string | null; note: string | null; href: string }
type Portfolio = Awaited<ReturnType<typeof getPortfolio>>

const MAX_ONS = 3
const DEBOUNCE_MS = 300

/** The remembered response of `key`, else one request for it. */
const remembered = <T,>(key: string, url: string): Promise<T> =>
  Promise.resolve(cachedValue<T>(key) ?? load(key, async () => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(String(res.status))
    return res.json() as Promise<T>
  }))

const typingIn = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

/**
 * The shell's search (odd/tasks/asset-page.md S1): any asset opens its page, an ON opens /ons/<isin>.
 * Desktop: at the top of every page, "/" focuses it. Phone: a bar over the shell's own, opened by its button.
 */
export default function ShellSearch({ inputRef, expanded = false, onCollapse = () => {}, wide = false }: {
  inputRef?: React.RefObject<HTMLInputElement>
  expanded?: boolean
  onCollapse?: () => void
  /** The Resumen's wider column (dashboard/page.tsx); every other page uses PAGE (components/ons/ui.tsx). */
  wide?: boolean
}) {
  const router = useRouter()
  const own = useRef<HTMLInputElement>(null)
  const input = inputRef ?? own
  const id = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [held, setHeld] = useState<string[]>([])
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [ons, setOns] = useState<OnListRow[]>([])
  const [market, setMarket] = useState<{ q: string; results: SearchResult[]; error?: string } | null>(null)
  const q = query.trim()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target)) return
      e.preventDefault()
      input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [input])

  // Yahoo finds what the app does not list; only the answer for the current text is kept.
  useEffect(() => {
    if (!shouldFetchSearch(q)) return
    let live = true
    const timer = setTimeout(() => {
      fetchTickerSearch(q).then(
        (results) => { if (live) setMarket({ q, results }) },
        (e) => { if (live) setMarket({ q, results: [], error: requestErrorMessage(e, 'No se pudo buscar. Probá de nuevo.') }) },
      )
    }, DEBOUNCE_MS)
    return () => { live = false; clearTimeout(timer) }
  }, [q])

  // On use, never on mount: what you hold, the app's catalog and the ON catalog (the explorer's key and shape).
  // They are only suggestions: a failure leaves them out and the next focus asks again.
  function warm() {
    Promise.resolve(cachedValue<Portfolio>(POSITIONS_KEY) ?? getPortfolio())
      .then((p) => setHeld((p.positions ?? []).map((x) => x.ticker)), () => {})
    remembered<CatalogEntry[]>('api:activos', '/api/activos').then(setCatalog, () => {})
    remembered<{ rows?: OnListRow[] }>('ons:catalog', '/api/ons').then((r) => setOns(r.rows ?? []), () => {})
  }

  const local = searchAssets(q, held, catalog, 6)
  const listed = new Set(local.map((r) => r.ticker))
  const hits: Hit[] = [
    ...local.map((r) => ({ key: r.ticker, ticker: r.ticker, name: r.name, note: r.held ? 'En cartera' : null, href: assetHref(r.ticker) })),
    ...(market?.q === q ? market.results : [])
      .filter((r) => !listed.has(r.symbol))
      .map((r) => ({ key: `m:${r.symbol}`, ticker: r.symbol, name: r.shortname || null, note: r.exchange || null, href: assetHref(r.symbol) })),
    ...(shouldFetchSearch(q) ? applyExplorer(ons, { ...DEFAULT_STATE, filters: { ...DEFAULT_STATE.filters, q } }).slice(0, MAX_ONS) : [])
      .map((r) => ({ key: `on:${r.isin}`, ticker: r.tickerO, name: r.issuer, note: 'ON', href: `/ons/${r.isin}` })),
  ]
  // Never past the last result.
  const selected = Math.max(0, Math.min(active, hits.length - 1))
  const failed = market?.q === q ? market.error : undefined
  const status = failed ?? (hits.length > 0 ? null
    : shouldFetchSearch(q) && market?.q !== q ? 'Buscando…'
    : q ? 'No hay activos que coincidan.' : 'Escribí un ticker o un nombre.')

  function close() {
    setOpen(false)
    input.current?.blur()
    onCollapse()
  }

  function go(href: string) {
    setQuery('')
    setActive(0)
    close()
    router.push(href)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (step) {
      setOpen(true)
      setActive(Math.max(0, Math.min(selected + step, hits.length - 1)))
    } else if (e.key === 'Enter' && (hits[selected] || q)) {
      // Enter before any result: the text as a ticker.
      go(hits[selected]?.href ?? assetHref(q.toUpperCase()))
    } else if (e.key === 'Escape') close()
    else return
    e.preventDefault()
  }

  return (
    <div className={cn(
      'mx-auto w-full pt-4',
      wide ? 'max-w-[1680px] px-8 xl:px-10' : 'max-w-[1240px] px-10',
      'max-[819px]:fixed max-[819px]:inset-x-0 max-[819px]:top-0 max-[819px]:z-40 max-[819px]:flex max-[819px]:h-14 max-[819px]:items-center max-[819px]:border-b max-[819px]:border-line max-[819px]:bg-canvas max-[819px]:px-2 max-[819px]:pt-0',
      !expanded && 'max-[819px]:hidden',
    )}>
      <div
        role="search"
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }}
        className="relative flex max-w-[460px] items-center gap-1 max-[819px]:max-w-none max-[819px]:flex-1"
      >
        <label className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-surface px-3 text-ink-3 hover:border-line-strong focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_28%,transparent)] max-[819px]:min-h-11">
          <Search className="h-4 w-4 flex-none" strokeWidth={1.5} aria-hidden="true" />
          <input
            ref={input}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true) }}
            onFocus={() => { setOpen(true); warm() }}
            onKeyDown={onKeyDown}
            aria-label="Buscar cualquier activo"
            aria-keyshortcuts="/"
            placeholder="Buscar cualquier activo: MELI, GGAL, SPY…"
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-activedescendant={open && hits[selected] ? `${id}-${selected}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="h-9 min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-3 focus:outline-none"
          />
          <kbd className="flex-none rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-xs max-[819px]:hidden">/</kbd>
        </label>
        <button
          type="button"
          onClick={close}
          aria-label="Cerrar búsqueda"
          className="grid h-11 w-11 flex-none place-items-center rounded-md text-ink-2 hover:bg-hover hover:text-ink min-[820px]:hidden"
        >
          <X className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
        </button>

        {open && (
          // Pressing inside keeps the focus in the field, so a click reaches its option.
          <div
            onMouseDown={(e) => e.preventDefault()}
            className="absolute inset-x-0 top-full z-40 mt-1 max-h-[60vh] overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-pop max-[819px]:fixed max-[819px]:bottom-0 max-[819px]:top-14 max-[819px]:mt-0 max-[819px]:max-h-none max-[819px]:rounded-none max-[819px]:border-x-0 max-[819px]:border-b-0"
          >
            <ul id={`${id}-list`} role="listbox" aria-label="Resultados">
              {hits.map((h, i) => (
                <li
                  key={h.key}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={i === selected}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(h.href)}
                  className={cn('flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm', i === selected && 'bg-hover')}
                >
                  <span className="w-20 flex-none truncate font-semibold text-ink">{h.ticker}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{h.name ?? ''}</span>
                  {h.note && <span className="flex-none text-xs text-ink-3">{h.note}</span>}
                </li>
              ))}
            </ul>
            {status && <p role="status" className={cn('px-3 py-2 text-sm', failed ? 'text-danger' : 'text-ink-3')}>{status}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
