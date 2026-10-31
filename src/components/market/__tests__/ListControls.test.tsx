import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { ListActions, ListStar, NewList } from '../ListControls'
import { forgetCached, setCachedValue } from '@/lib/client-cache'
import { itemsKey } from '../MarketPage'
import type { ViewRow } from '@/lib/market-view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: Root[] = []
afterEach(async () => {
  // Unmount first: an open popover's portal lives in <body> and must leave with its root.
  await act(async () => { roots.splice(0).forEach((r) => r.unmount()) })
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  forgetCached()
})

const symbols = { locals: new Set(['GGAL']), cedears: new Set(['AAPL']) }
const ggal: ViewRow = { key: 'BCBA:GGAL', ticker: 'GGAL', stored: 'BCBA:GGAL', name: 'Grupo Galicia', price: 6000, changePct: 0.03, note: null, line: { kind: 'local', line: 'GGAL' } }
const lists = [{ id: 'l1', name: 'Bancos', item_count: 2 }, { id: 'l2', name: 'Energía', item_count: 0 }]

function stubFetch(items: Record<string, string[]> = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const m = url.match(/^\/api\/watchlist\?watchlistId=(\w+)&fields=symbols$/)
    if (m) return new Response(JSON.stringify({ items: (items[m[1]] ?? []).map((symbol, i) => ({ id: `i${i}`, symbol, added_at: '2026-10-01' })) }), { status: 200 })
    if (init?.method === 'POST' && url === '/api/watchlist/lists') return new Response(JSON.stringify({ id: 'l9', name: 'Nueva' }), { status: 201 })
    return new Response('{}', { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function mount(node: React.ReactNode) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  roots.push(root)
  await act(async () => { root.render(node) })
  return el
}
const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click() }) }
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const calls = (f: ReturnType<typeof vi.fn>, method: string) => f.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === method)
const box = (name: string) => [...document.body.querySelectorAll('label')].find((l) => l.textContent === name)!.querySelector('input')!

describe('ListStar', () => {
  it('shows which of the user’s lists hold the asset, either spelling counted', async () => {
    stubFetch({ l1: ['GGAL.BA'] })
    const el = await mount(<ListStar row={ggal} lists={lists} symbols={symbols} onChanged={vi.fn()} />)
    await click(el.querySelector('button')!)
    expect(box('Bancos').checked).toBe(true)
    expect(box('Energía').checked).toBe(false)
  })

  it('adding writes the symbol Gráficos uses for a BYMA share', async () => {
    const fetchMock = stubFetch({ l1: [] })
    const onChanged = vi.fn()
    const el = await mount(<ListStar row={ggal} lists={lists} symbols={symbols} onChanged={onChanged} />)
    await click(el.querySelector('button')!)
    await click(box('Energía'))
    const [[url, init]] = calls(fetchMock, 'POST')
    expect(url).toBe('/api/watchlist')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ symbol: 'BCBA:GGAL', watchlistId: 'l2' })
    expect(onChanged).toHaveBeenCalledWith('l2')
  })

  it('removing deletes every stored spelling of the asset in that list, as stored', async () => {
    const fetchMock = stubFetch({ l1: ['GGAL.BA', 'BCBA:GGAL', 'GGAL'] })
    const el = await mount(<ListStar row={ggal} lists={lists} symbols={symbols} onChanged={vi.fn()} />)
    await click(el.querySelector('button')!)
    await click(box('Bancos'))
    expect(calls(fetchMock, 'DELETE').map(([u]) => u)).toEqual([
      '/api/watchlist?symbol=GGAL.BA&watchlistId=l1',
      '/api/watchlist?symbol=BCBA%3AGGAL&watchlistId=l1',
    ])
  })

  it('a star already known as held reads filled before opening', async () => {
    stubFetch()
    setCachedValue(itemsKey('l1'), ['BCBA:GGAL'])
    const el = await mount(<ListStar row={ggal} lists={lists} symbols={symbols} onChanged={vi.fn()} />)
    expect(el.querySelector('button')!.getAttribute('aria-label')).toBe('GGAL está en tus listas: cambiar')
  })
})

describe('NewList', () => {
  it('creates a list by name and reports its id', async () => {
    const fetchMock = stubFetch()
    const onCreated = vi.fn()
    const el = await mount(<NewList onCreated={onCreated} />)
    await click(el.querySelector('button')!)
    await type(el.querySelector('input')!, 'Bancos')
    await act(async () => { el.querySelector('form')!.requestSubmit() })
    const [[url, init]] = calls(fetchMock, 'POST')
    expect(url).toBe('/api/watchlist/lists')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ name: 'Bancos' })
    expect(onCreated).toHaveBeenCalledWith('l9', 'Bancos')
  })

  it('shows the server’s reason when it refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Llegaste al máximo de 10 listas' }), { status: 400 })))
    const el = await mount(<NewList onCreated={vi.fn()} />)
    await click(el.querySelector('button')!)
    await type(el.querySelector('input')!, 'Otra')
    await act(async () => { el.querySelector('form')!.requestSubmit() })
    expect(el.textContent).toContain('Llegaste al máximo de 10 listas')
  })
})

describe('ListActions', () => {
  it('renames the list', async () => {
    const fetchMock = stubFetch()
    const onChanged = vi.fn()
    const el = await mount(<ListActions list={lists[0]} onChanged={onChanged} onDeleted={vi.fn()} />)
    await click([...el.querySelectorAll('button')].find((b) => b.textContent === 'Renombrar')!)
    await type(el.querySelector('input')!, 'Bancos AR')
    await act(async () => { el.querySelector('form')!.requestSubmit() })
    const [[url, init]] = calls(fetchMock, 'PATCH')
    expect(url).toBe('/api/watchlist/lists/l1')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ name: 'Bancos AR' })
    expect(onChanged).toHaveBeenCalled()
  })

  it('deletes the list only after confirming', async () => {
    const fetchMock = stubFetch()
    const onDeleted = vi.fn()
    const el = await mount(<ListActions list={lists[0]} onChanged={vi.fn()} onDeleted={onDeleted} />)
    await click([...el.querySelectorAll('button')].find((b) => b.textContent === 'Eliminar lista')!)
    expect(calls(fetchMock, 'DELETE')).toHaveLength(0)
    await click([...el.querySelectorAll('button')].find((b) => b.textContent === 'Eliminar')!)
    expect(calls(fetchMock, 'DELETE').map(([u]) => u)).toEqual(['/api/watchlist/lists/l1'])
    expect(onDeleted).toHaveBeenCalled()
  })
})
