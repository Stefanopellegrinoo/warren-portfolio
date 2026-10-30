import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { forgetCached } from '@/lib/client-cache'

// odd/tasks/asset-page.md S1: the shell's search finds any asset and opens its page; ONs open theirs.
const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

import ShellSearch from '../ShellSearch'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ON_ROW = { isin: 'AR0000000001', tickerO: 'YMCJO', tickerD: 'YMCJD', issuer: 'YPF', description: null, maturityDate: '2030-01-01', mdYears: null }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/positions') return Response.json({ positions: [{ ticker: 'GGAL' }], onPositions: [] })
    if (url === '/api/activos') return Response.json([{ ticker: 'MELI', nombre: 'MercadoLibre' }])
    if (url === '/api/ons') return Response.json({ rows: [ON_ROW], asOf: null, stale: false, prices: { ok: true, fetchedAt: null } })
    if (url.startsWith('/api/ticker/search')) return Response.json({ results: [{ symbol: 'TM', shortname: 'Toyota Motor', exchange: 'NYQ' }] })
    throw new Error(`unexpected fetch ${url}`)
  }))
})
afterEach(() => { vi.unstubAllGlobals(); push.mockReset(); forgetCached(); document.body.innerHTML = '' })

async function mount() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  const onCollapse = vi.fn()
  await act(async () => {
    root.render(<><input aria-label="Otro campo" /><ShellSearch onCollapse={onCollapse} /></>)
  })
  const input = el.querySelector<HTMLInputElement>('input[aria-label="Buscar cualquier activo"]')!
  return { el, input, onCollapse, unmount: () => act(() => root.unmount()) }
}

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
// The Yahoo search waits 300 ms after the last keystroke.
const afterDebounce = () => act(async () => { await new Promise(r => setTimeout(r, 350)) })

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
const key = (target: EventTarget, k: string) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  act(() => { target.dispatchEvent(e) })
  return e
}
const option = (el: HTMLElement, text: string) => [...el.querySelectorAll<HTMLElement>('[role="option"]')].find(o => o.textContent?.includes(text))

describe('ShellSearch', () => {
  it('"/" focuses the search, but not while typing in another field', async () => {
    const { el, input, unmount } = await mount()
    expect(key(window, '/').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(input)

    const other = el.querySelector<HTMLInputElement>('input[aria-label="Otro campo"]')!
    act(() => { other.focus() })
    expect(key(other, '/').defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(other)
    unmount()
  })

  it('picking a result opens its asset page', async () => {
    const { el, input, unmount } = await mount()
    act(() => { input.focus() })
    await flush()
    type(input, 'merca')
    await flush()
    act(() => { option(el, 'MELI')!.click() })
    expect(push).toHaveBeenCalledWith('/activo/MELI')
    expect(input.value).toBe('')
    unmount()
  })

  it('finds any asset through the market search; arrows and Enter pick it', async () => {
    const { el, input, unmount } = await mount()
    act(() => { input.focus() })
    type(input, 'toyota')
    await afterDebounce()
    await flush()
    expect(option(el, 'Toyota Motor')).toBeDefined()
    key(input, 'ArrowDown')
    key(input, 'ArrowUp')
    expect(input.getAttribute('aria-activedescendant')).toBe(option(el, 'TM')!.id)
    key(input, 'Enter')
    expect(push).toHaveBeenCalledWith('/activo/TM')
    unmount()
  })

  it('sends an ON to its own page, by ISIN', async () => {
    const { el, input, unmount } = await mount()
    act(() => { input.focus() })
    await flush()
    type(input, 'ymcj')
    await flush()
    act(() => { option(el, 'YMCJO')!.click() })
    expect(push).toHaveBeenCalledWith('/ons/AR0000000001')
    unmount()
  })

  it('lists what you hold on focus, and Escape closes the list', async () => {
    const { el, input, onCollapse, unmount } = await mount()
    act(() => { input.focus() })
    await flush()
    expect(option(el, 'GGAL')?.textContent).toContain('En cartera')
    key(input, 'Escape')
    expect(el.querySelector('[role="listbox"]')).toBeNull()
    expect(onCollapse).toHaveBeenCalled()
    unmount()
  })
})
