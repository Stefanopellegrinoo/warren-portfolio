import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// Node 25 ships a stub localStorage without methods; the persisted chart store needs a real one.
vi.hoisted(() => {
  const data = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), clear: () => data.clear() },
  })
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { CompareSheet } = await import('../CompareSheet')
const { useChartStore } = await import('@/lib/store/chart-store')

afterEach(() => { document.body.innerHTML = '' })

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 50)) })
const boxes = () => [...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')]
const labelOf = (b: HTMLInputElement) => b.closest('label')!.textContent!.trim()
const box = (label: string) => boxes().find((b) => labelOf(b) === label)!

async function render(main: string, compared: string[]) {
  useChartStore.setState({ compareSymbols: compared, symbolDialogOpen: false, symbolDialogOnSelect: null })
  const onOpenChange = vi.fn()
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<CompareSheet open onOpenChange={onOpenChange} main={main} />) })
  await flush()
  return { onOpenChange, unmount: () => act(() => root.unmount()) }
}

describe('CompareSheet', () => {
  it('offers Mi cartera and the quick ETFs, checked when already compared', async () => {
    const { unmount } = await render('AAPL', ['SPY'])

    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Comparar con')
    expect(boxes().map(labelOf)).toEqual(['Mi cartera', 'SPY', 'QQQ', 'DIA', 'EEM', 'VT', 'MERVAL (USD CCL)'])
    expect(boxes().filter((b) => b.checked).map(labelOf)).toEqual(['SPY'])
    unmount()
  })

  it('checking adds, unchecking takes out', async () => {
    const { unmount } = await render('AAPL', ['SPY'])

    act(() => box('DIA').click())
    expect(useChartStore.getState().compareSymbols).toEqual(['SPY', 'DIA'])
    act(() => box('SPY').click())
    expect(useChartStore.getState().compareSymbols).toEqual(['DIA'])
    unmount()
  })

  it('with five compared the rest wait', async () => {
    const { unmount } = await render('AAPL', ['SPY', 'QQQ', 'DIA', 'EEM', 'VT'])

    expect(box('MERVAL (USD CCL)').disabled).toBe(true)
    expect(box('Mi cartera').disabled).toBe(true)
    expect(box('SPY').disabled).toBe(false)
    unmount()
  })

  it('on Mi cartera it is not offered against itself', async () => {
    const { unmount } = await render('__portfolio__', ['SPY'])

    expect(boxes().map(labelOf)).not.toContain('Mi cartera')
    unmount()
  })

  it('a ticker found by search shows checked, to take it out again', async () => {
    const { unmount } = await render('AAPL', ['NVDA'])

    expect(box('NVDA').checked).toBe(true)
    unmount()
  })

  it('Buscar otro closes the sheet and opens the search; its pick is compared, the chart stays', async () => {
    useChartStore.setState({ symbol: 'AAPL' })
    const { onOpenChange, unmount } = await render('AAPL', ['SPY'])

    act(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Buscar otro')!.click())

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(useChartStore.getState().symbolDialogOpen).toBe(true)
    act(() => useChartStore.getState().symbolDialogOnSelect!('NVDA'))
    expect(useChartStore.getState().compareSymbols).toEqual(['SPY', 'NVDA'])
    expect(useChartStore.getState().symbol).toBe('AAPL')
    unmount()
  })
})
