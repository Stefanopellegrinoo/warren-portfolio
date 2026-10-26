import { describe, it, expect, vi, afterEach } from 'vitest'
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { forgetCandles, useCandles } from '../useCandles'
import { NO_CONNECTION } from '@/lib/request-errors'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); forgetCandles(); document.body.innerHTML = '' })

const CANDLES_FAILED = 'No se pudieron cargar las velas. Probá de nuevo.'

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

type State = ReturnType<typeof useCandles>
let state: State
function Probe({ symbol, onState }: { symbol: string; onState: (s: State) => void }) {
  const s = useCandles(symbol, '1d')
  useEffect(() => onState(s))
  return null
}

async function render(symbol: string, answer: (url: string) => Response | Promise<Response>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return answer(url) }))
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  const show = (sym: string) => act(async () => { root.render(<Probe symbol={sym} onState={(s) => { state = s }} />) })
  await show(symbol)
  await flush()
  return { calls, show, unmount: () => act(() => root.unmount()) }
}

describe('useCandles — the error the chart shows is Spanish', () => {
  it('a Binance refusal ("klines 451") reads as Spanish', async () => {
    const { calls, unmount } = await render('BTCUSDT', () => new Response('{}', { status: 451 }))

    expect(calls[0]).toContain('api.binance.com/api/v3/klines?symbol=BTCUSDT')
    expect(state.status).toBe('error')
    expect(state.error).toBe(CANDLES_FAILED)
    unmount()
  })

  it('a Binance request that never left says there is no connection, not "Failed to fetch"', async () => {
    const { unmount } = await render('BTCUSDT', () => { throw new TypeError('Failed to fetch') })

    expect(state.error).toBe(NO_CONNECTION)
    unmount()
  })

  it('the server message for a stock is kept', async () => {
    const { calls, unmount } = await render('AAPL', () => Response.json({ error: 'No encontramos datos de ese ticker.' }, { status: 404 }))

    expect(calls[0]).toBe('/api/klines?ticker=AAPL&interval=1d')
    expect(state.error).toBe('No encontramos datos de ese ticker.')
    unmount()
  })

  it('a stock error page without a message reads as Spanish, never "Error 500"', async () => {
    const { unmount } = await render('AAPL', () => new Response('<html>500</html>', { status: 500 }))

    expect(state.error).toBe(CANDLES_FAILED)
    unmount()
  })

  it('loaded candles are still ready', async () => {
    const { unmount } = await render('AAPL', () => Response.json([{ time: 1_700_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]))

    expect(state.status).toBe('ready')
    expect(state.candles).toHaveLength(1)
    expect(state.error).toBeUndefined()
    unmount()
  })
})

describe('useCandles — quick to show, light to keep live (S4)', () => {
  const k = (time: number, close: number) => ({ time, open: 1, high: 2, low: 0.5, close, volume: 1 })
  const answer = (history: object[], recent: object[]) => (url: string) => Response.json(url.includes('&days=') ? recent : history)

  it('a stock asks its history and a recent window together and lays the window over the end', async () => {
    const { calls, unmount } = await render('AAPL', answer([k(100, 1), k(200, 2), k(300, 3)], [k(300, 30), k(400, 4)]))

    expect(calls).toEqual(['/api/klines?ticker=AAPL&interval=1d', '/api/klines?ticker=AAPL&interval=1d&days=14'])
    expect(state.candles.map(c => c.close)).toEqual([1, 2, 30, 4])
    unmount()
  })

  it('a stock keeps its live bars by polling only the recent window', async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] })
    const { calls, unmount } = await render('AAPL', answer([k(100, 1), k(200, 2)], [k(200, 2), k(300, 3)]))
    calls.length = 0

    await act(async () => { vi.advanceTimersByTime(30_000) })
    await flush()

    expect(calls).toEqual(['/api/klines?ticker=AAPL&interval=1d&days=14'])
    expect(state.candles.map(c => c.close)).toEqual([1, 2, 3])
    unmount()
  })

  it('an asset seen before shows its candles at once while they refresh behind', async () => {
    let pending = false
    const { show, unmount } = await render('AAPL', (url) =>
      pending && url.includes('AAPL') ? new Promise<Response>(() => {}) : Response.json(url.includes('MSFT') ? [k(100, 9)] : [k(100, 1), k(200, 2)]))
    await show('MSFT')
    await flush()
    pending = true

    await show('AAPL')

    expect(state.status).toBe('ready')
    expect(state.candles.map(c => c.close)).toEqual([1, 2])
    unmount()
  })

  it('an asset never seen still shows Cargando until its candles arrive', async () => {
    const { show, unmount } = await render('AAPL', (url) => url.includes('MSFT') ? new Promise<Response>(() => {}) : Response.json([k(100, 1)]))

    await show('MSFT')

    expect(state.status).toBe('loading')
    unmount()
  })
})

describe('useCandles — Mi cartera', () => {
  it('loads the portfolio series once, as bars whose every price is its value', async () => {
    const { calls, unmount } = await render('__portfolio__', () =>
      Response.json({ series: { __portfolio__: { points: [{ time: '2026-01-02', value: 100 }, { time: '2026-01-05', value: 104.5 }] } } }),
    )

    expect(calls).toEqual(['/api/compare-series?symbols=__portfolio__'])
    expect(state.status).toBe('ready')
    expect(state.candles).toEqual([
      { time: 1767312000, open: 100, high: 100, low: 100, close: 100, volume: 0 },
      { time: 1767571200, open: 104.5, high: 104.5, low: 104.5, close: 104.5, volume: 0 },
    ])
    unmount()
  })

  it('a portfolio without history says so', async () => {
    const { unmount } = await render('__portfolio__', () => Response.json({ series: { __portfolio__: { error: 'no_data' } } }))

    expect(state.status).toBe('error')
    expect(state.error).toBe('Todavía no hay historia de tu cartera')
    unmount()
  })
})
