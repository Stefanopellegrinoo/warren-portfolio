import { describe, it, expect, vi, afterEach } from 'vitest'
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { useCandles } from '../useCandles'
import { NO_CONNECTION } from '@/lib/request-errors'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

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
  await act(async () => { root.render(<Probe symbol={symbol} onState={(s) => { state = s }} />) })
  await flush()
  return { calls, unmount: () => act(() => root.unmount()) }
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
