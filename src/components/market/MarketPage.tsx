'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { useCached } from '@/lib/client-cache'
import { getPortfolio } from '@/lib/warren/positions'
import { DEFAULT_CURRENCY, readCurrency, saveCurrency } from '@/lib/resumen/currency'
import type { Currency } from '@/lib/multicurrency'
import type { MarketBoard } from '@/lib/market-board'
import {
  DEFAULT_LIST, filterRows, listRows, marketRows, parseView, serializeView, sortRows,
  type MarketList, type SortKey, type View,
} from '@/lib/market-view'
import { cn, formatAge } from '@/lib/utils'
import { CurrencySelector } from '@/components/resumen/SummaryHeader'
import { btnSecondary, field, Loading, LoadError } from '@/components/ons/ui'
import MarketLists, { type ListEntry } from './MarketLists'
import { ListActions, ListStar, NewList } from './ListControls'
import MarketTable, { MarketSortSelect } from './MarketTable'

export interface WatchlistRow { id: string; name: string; item_count: number }

export const CARTERA = 'cartera'
const PAGE_SIZE = 100
const OPEN_REFRESH_MS = 60_000
const CLOSED_REFRESH_MS = 5 * 60_000
const BOARD_KEY = 'market:board'
export const LISTS_KEY = 'market:lists'
export const itemsKey = (id: string) => `market:list:${id}`

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(String(res.status))
  return res.json() as Promise<T>
}

const isMarket = (list: string): list is MarketList => list === 'lider' || list === 'cedears'

const loadItems = (list: string): Promise<string[]> => list === CARTERA
  ? getPortfolio().then((d) => (d.positions ?? []).map((p) => p.ticker))
  : getJson<{ items: { symbol: string }[] }>(`/api/watchlist?watchlistId=${encodeURIComponent(list)}&fields=symbols`).then((d) => d.items.map((i) => i.symbol))

/**
 * Mercado (odd/tasks/market-page.md S2–S4): the Panel líder, the CEDEARs and the user's lists — the same
 * lists as Gráficos — in Pesos, MEP or Cable, with each asset's chart and page one tap away.
 */
export default function MarketPage() {
  const pathname = usePathname()
  const params = useSearchParams()
  // Local state drives the controls; the URL mirrors it so a view can be shared or reloaded (as the ONs explorer).
  const [view, setView] = useState<View>(() => parseView(params))
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE_SIZE)
  const [currency, setCurrency] = useState<Currency>(DEFAULT_CURRENCY)
  useEffect(() => setCurrency(readCurrency()), []) // storage only after mount: the server render has none

  const board = useCached(BOARD_KEY, () => getJson<MarketBoard>('/api/market'))
  const lists = useCached(LISTS_KEY, () => getJson<{ lists: WatchlistRow[] }>('/api/watchlist/lists').then((d) => d.lists))
  // A list deleted elsewhere (or a stale link) shows the Panel líder until another one is picked.
  const known = isMarket(view.list) || view.list === CARTERA || !lists.data || lists.data.some((l) => l.id === view.list)
  const list = known ? view.list : DEFAULT_LIST
  const items = useCached(isMarket(list) ? null : list === CARTERA ? 'market:cartera' : itemsKey(list), () => loadItems(list))
  const b = board.data ?? null

  // Held in Cartera, counted before Cartera is opened (S2: every list shows its count).
  const cartera = useCached('market:cartera', () => loadItems(CARTERA))

  // About every minute while BYMA trades, every few minutes while it is closed so a page left open
  // sees the opening, and at once when the tab comes back (background timers sleep). Only in view.
  const reloadBoard = useRef(board.reload)
  useLayoutEffect(() => { reloadBoard.current = board.reload })
  const open = b?.marketOpen ?? false
  useEffect(() => {
    const read = () => { if (document.visibilityState === 'visible') reloadBoard.current() }
    const timer = setInterval(read, open ? OPEN_REFRESH_MS : CLOSED_REFRESH_MS)
    document.addEventListener('visibilitychange', read)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', read) }
  }, [open])

  const push = (next: View) => {
    setView(next)
    const qs = serializeView(next)
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname)
    setShown(PAGE_SIZE)
  }
  const select = (list: string) => push({ ...view, list })
  const onSort = (key: SortKey, dir?: 'asc' | 'desc') => push({
    ...view,
    sort: dir ? { key, dir } : view.sort.key === key ? { key, dir: view.sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'ticker' ? 'asc' : 'desc' },
  })
  const pickCurrency = (c: Currency) => { setCurrency(c); saveCurrency(c) }

  const symbols = useMemo(() => ({ locals: new Set(b?.locals.map((r) => r.symbol)), cedears: new Set(b?.cedears.map((r) => r.symbol)) }), [b])

  const rows = useMemo(() => {
    if (!b) return []
    const base = isMarket(list) ? marketRows(b, list) : items.data ? listRows(items.data, b) : []
    return sortRows(filterRows(base, query), view.sort)
  }, [b, list, view.sort, items.data, query])

  if (!b && board.error) return <LoadError message="No se pudo cargar el mercado." onRetry={board.reload} />
  if (!b) return <Loading label="Cargando el mercado" />

  const market: ListEntry[] = [
    { key: 'lider', name: 'Panel líder', count: b.lider.length },
    { key: 'cedears', name: 'CEDEARs', count: b.cedears.length },
  ]
  const mine: ListEntry[] = [
    { key: CARTERA, name: 'Cartera', count: cartera.data?.length ?? null },
    ...(lists.data ?? []).map((l) => ({ key: l.id, name: l.name, count: l.item_count })),
  ]
  const current = [...market, ...mine].find((e) => e.key === list)
  const userLists = lists.data ?? []
  const ownList = userLists.find((l) => l.id === list)
  // An edit made here is the same list in Gráficos: re-read the counts, and the items on screen.
  const listChanged = (id: string) => { lists.reload(); if (id === list) items.reload() }
  const empty = query.trim() ? 'Sin resultados. Probá con otra búsqueda.'
    : list === CARTERA ? 'No tenés acciones ni CEDEARs en cartera.'
      : 'Esta lista está vacía. Agregá activos con la estrella de cada fila.'

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 min-[1080px]:grid-cols-[200px_minmax(0,1fr)]">
      <MarketLists market={market} mine={mine} selected={list} onSelect={select}
        footer={<NewList onCreated={(id, name) => { lists.mutate([...userLists, { id, name, item_count: 0 }]); select(id) }} />} />
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative flex min-w-[12rem] flex-1 items-center">
            <span className="sr-only">Buscar en {current?.name ?? 'la lista'}</span>
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-ink-3" strokeWidth={1.5} aria-hidden="true" />
            <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE_SIZE) }}
              placeholder="Buscar por ticker o nombre" className={cn(field, 'w-full pl-9')} />
          </label>
          <CurrencySelector value={currency} onChange={pickCurrency} />
        </div>
        <p role="status" className="text-[13px] text-ink-3">
          {b.marketOpen ? `Mercado abierto · precios de BYMA, ${formatAge(b.updatedAt ?? undefined)}.` : 'Mercado cerrado, precios al cierre.'}
        </p>
        {ownList && <ListActions key={ownList.id} list={ownList} onChanged={() => lists.reload()}
          onDeleted={() => { lists.mutate(userLists.filter((l) => l.id !== ownList.id)); select('lider') }} />}
        <MarketSortSelect sort={view.sort} onSort={onSort} className="min-[1080px]:hidden" />
        {items.error && !items.data
          ? <LoadError message="No se pudo cargar la lista." onRetry={items.reload} />
          : items.loading && !items.data ? <Loading label="Cargando la lista" />
            : <MarketTable rows={rows.slice(0, shown)} sort={view.sort} onSort={onSort} currency={currency} fx={b.fx} empty={empty}
              star={(row) => <ListStar row={row} lists={userLists} symbols={symbols} onChanged={listChanged} />} />}
        {rows.length > shown && (
          <button type="button" className={cn(btnSecondary, 'w-full')} onClick={() => setShown((s) => s + PAGE_SIZE)}>
            Mostrar {Math.min(PAGE_SIZE, rows.length - shown)} más ({rows.length - shown} restantes)
          </button>
        )}
      </div>
    </div>
  )
}
