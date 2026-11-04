'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { useCached } from '@/lib/client-cache'
import { getPortfolio } from '@/lib/warren/positions'
import { DEFAULT_CURRENCY, readCurrency, saveCurrency } from '@/lib/resumen/currency'
import type { Currency } from '@/lib/multicurrency'
import { DEFAULT_LIST, parseView, serializeView, type MarketList, type SortKey, type View } from '@/lib/market-view'
import { cn, formatAge } from '@/lib/utils'
import { CurrencySelector } from '@/components/resumen/SummaryHeader'
import { field, Loading, LoadError } from '@/components/ons/ui'
import MarketLists, { type ListEntry } from './MarketLists'
import { ListActions, ListStar, itemsOf } from './ListControls'
import MarketTable from './MarketTable'
import MarketPager from './MarketPager'
import { CARTERA, CARTERA_KEY, LISTS_KEY, itemsKey, type MarketPageData, type WatchlistRow } from './keys'

const OPEN_REFRESH_MS = 60_000
const CLOSED_REFRESH_MS = 5 * 60_000
const SEARCH_WAIT_MS = 300

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(String(res.status))
  return res.json() as Promise<T>
}

const isMarket = (list: string): list is MarketList => list === 'lider' || list === 'cedears'

const loadItems = (list: string): Promise<string[]> => list === CARTERA
  ? getPortfolio().then((d) => (d.positions ?? []).map((p) => p.ticker))
  : itemsOf(list)

/** S10: the server answers only the page asked for: the list (or a list's symbols), page, size, sort and search. */
function pageUrl(list: string, symbols: string[] | null, view: View, q: string): string {
  const p = new URLSearchParams()
  if (symbols) p.set('symbols', symbols.join(','))
  else p.set('list', list)
  p.set('page', String(view.page))
  p.set('size', String(view.size))
  p.set('sort', `${view.sort.key}:${view.sort.dir}`)
  if (q) p.set('q', q)
  return `/api/market?${p}`
}

const noun = (list: string, n: number) =>
  list === 'lider' ? (n === 1 ? 'acción' : 'acciones') : list === 'cedears' ? (n === 1 ? 'CEDEAR' : 'CEDEARs') : n === 1 ? 'activo' : 'activos'

/**
 * Mercado (odd/tasks/market-page.md S2–S4, S8–S12): the Panel líder, the CEDEARs and the user's lists — the same
 * lists as Gráficos — in Pesos, MEP or Cable, a page at a time, each asset's chart and page one tap away.
 */
export default function MarketPage() {
  const pathname = usePathname()
  const params = useSearchParams()
  // Local state drives the controls; the URL mirrors it so a view can be shared or reloaded (as the ONs explorer).
  const [view, setView] = useState<View>(() => parseView(params))
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  const [currency, setCurrency] = useState<Currency>(DEFAULT_CURRENCY)
  useEffect(() => { setCurrency(readCurrency()) }, []) // storage only after mount: the server render has none

  const push = (next: View) => {
    setView(next)
    const qs = serializeView(next)
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname)
  }

  // The search asks the server once the typing stops, and starts again from page 1.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = query.trim()
      if (next === q) return
      setQ(next)
      push({ ...view, page: 1 })
    }, SEARCH_WAIT_MS)
    return () => clearTimeout(timer)
  })

  const lists = useCached(LISTS_KEY, () => getJson<{ lists: WatchlistRow[] }>('/api/watchlist/lists').then((d) => d.lists))
  // A list deleted elsewhere (or a stale link) shows the Panel líder until another one is picked.
  const known = isMarket(view.list) || view.list === CARTERA || !lists.data || lists.data.some((l) => l.id === view.list)
  const list = known ? view.list : DEFAULT_LIST
  // Held in Cartera, counted before Cartera is opened (S2: every list shows its count).
  const cartera = useCached(CARTERA_KEY, () => loadItems(CARTERA))
  const items = useCached(isMarket(list) || list === CARTERA ? null : itemsKey(list), () => loadItems(list))
  // What every list of the user holds, read once (symbols only), so the stars on any list show it.
  const listIds = (lists.data ?? []).map((l) => l.id)
  const held = useCached(listIds.length ? `market:held:${listIds.join(',')}` : null, () =>
    Promise.all(listIds.map(async (id) => [id, await itemsOf(id)] as const)).then((all) => Object.fromEntries(all) as Record<string, string[]>))
  const symbols = isMarket(list) ? null : list === CARTERA ? cartera.data ?? null : items.data ?? null
  const waiting = !isMarket(list) && symbols === null
  const url = waiting || symbols?.length === 0 ? null : pageUrl(list, symbols, view, q)
  const page = useCached(url, () => getJson<MarketPageData>(url!))

  // The last page shown stays on screen while the next one loads (no flash between pages).
  const [kept, setKept] = useState<MarketPageData | null>(null)
  if (page.data && page.data !== kept) setKept(page.data)
  const data = page.data ?? kept

  // About every minute while BYMA trades, every few minutes while it is closed so a page left open
  // sees the opening, and at once when the tab comes back (background timers sleep). Only in view.
  const section = useRef<HTMLElement>(null)
  const reloadPage = useRef(page.reload)
  useLayoutEffect(() => { reloadPage.current = page.reload })
  const open = data?.marketOpen ?? false
  useEffect(() => {
    const read = () => { if (document.visibilityState === 'visible') reloadPage.current() }
    const timer = setInterval(read, open ? OPEN_REFRESH_MS : CLOSED_REFRESH_MS)
    document.addEventListener('visibilitychange', read)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', read) }
  }, [open])

  const select = (next: string) => { setQuery(''); setQ(''); push({ ...view, list: next, page: 1 }) }
  const onSort = (key: SortKey) => push({
    ...view,
    page: 1,
    sort: view.sort.key === key ? { key, dir: view.sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'ticker' ? 'asc' : 'desc' },
  })
  const pickCurrency = (c: Currency) => { setCurrency(c); saveCurrency(c) }

  if (!data && page.error) return <LoadError message="No se pudo cargar el mercado." onRetry={page.reload} />
  if (!data && url) return <Loading label="Cargando el mercado" />

  const userLists = lists.data ?? []
  const market: ListEntry[] = [
    { key: 'lider', name: 'Panel líder', count: data?.counts.lider ?? null },
    { key: 'cedears', name: 'CEDEARs', count: data?.counts.cedears ?? null },
  ]
  const mine: ListEntry[] = [
    { key: CARTERA, name: 'Cartera', count: cartera.data?.length ?? null },
    ...userLists.map((l) => ({ key: l.id, name: l.name, count: l.item_count })),
  ]
  const current = [...market, ...mine].find((e) => e.key === list)
  const ownList = userLists.find((l) => l.id === list)
  // An edit made here is the same list in Gráficos: re-read the counts, and the items on screen.
  const listChanged = (id: string, next: string[]) => {
    held.mutate({ ...held.data, [id]: next })
    lists.reload()
    if (id === list) items.reload()
  }
  const empty = q ? 'Sin resultados. Probá con otra búsqueda.'
    : list === CARTERA ? 'No tenés acciones ni CEDEARs en cartera.'
      : 'Esta lista está vacía. Agregá activos con la estrella de cada fila.'
  const shown = url ? data : null // an empty list asks nothing and shows nothing
  const total = shown?.total ?? 0

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-serif text-[2rem] font-normal leading-tight tracking-[-0.015em] max-[819px]:text-2xl">Mercado</h1>
          {data && (
            <p role="status" className="mt-1 flex items-center gap-1.5 text-[13px] text-ink-3">
              <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', data.marketOpen ? 'bg-ok-dot' : 'bg-neutral-dot')} />
              {data.marketOpen ? `Abierto · precios de BYMA, ${formatAge(data.updatedAt ?? undefined)}` : 'Mercado cerrado, precios al cierre.'}
            </p>
          )}
        </div>
        <CurrencySelector value={currency} onChange={pickCurrency} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 min-[1080px]:grid-cols-[208px_minmax(0,1fr)] min-[1080px]:gap-5">
        <MarketLists market={market} mine={mine} selected={list} onSelect={select}
          onCreated={(id, name) => { lists.mutate([...userLists, { id, name, item_count: 0 }]); select(id) }} />
        <section ref={section} aria-label={current?.name ?? 'Lista'} className="min-w-0 overflow-hidden rounded-lg border border-line bg-surface">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line p-2.5">
            <label className="relative flex min-w-[12rem] flex-1 items-center">
              <span className="sr-only">Buscar en {current?.name ?? 'la lista'}</span>
              <Search className="pointer-events-none absolute left-3 h-4 w-4 text-ink-3" strokeWidth={1.5} aria-hidden="true" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={`Buscar en ${current?.name ?? 'la lista'}`} className={cn(field, 'h-9 w-full bg-canvas pl-9 max-[1079px]:h-11')} />
            </label>
            {shown && <span className="whitespace-nowrap text-[13px] tabular-nums text-ink-3">{total} {noun(list, total)}</span>}
            {ownList && <ListActions key={ownList.id} list={ownList} onChanged={() => lists.reload()}
              onDeleted={() => { lists.mutate(userLists.filter((l) => l.id !== ownList.id)); select('lider') }} />}
          </div>
          {items.error && !items.data
            ? <div className="p-4"><LoadError message="No se pudo cargar la lista." onRetry={items.reload} /></div>
            : waiting ? <div className="p-4"><Loading label="Cargando la lista" /></div>
              : (
                <div className={cn(page.loading && data && 'opacity-60 transition-opacity')}>
                  <MarketTable rows={shown?.rows ?? []} sort={view.sort} onSort={onSort} currency={currency} fx={shown?.fx ?? { mep: null, ccl: null }}
                    empty={empty} star={(row, label) => <ListStar row={row} lists={userLists} held={held.data} onChanged={listChanged} label={label} />} />
                </div>
              )}
          {shown && (
            <MarketPager page={shown.page} pages={shown.pages} total={shown.total} size={shown.size}
              onPage={(p) => {
                push({ ...view, page: p })
                // A new page starts at the top of the list, not where the pager was.
                if ((section.current?.getBoundingClientRect().top ?? 0) < 0) section.current?.scrollIntoView({ block: 'start' })
              }} onSize={(s) => push({ ...view, size: s, page: 1 })} />
          )}
        </section>
      </div>
    </div>
  )
}
