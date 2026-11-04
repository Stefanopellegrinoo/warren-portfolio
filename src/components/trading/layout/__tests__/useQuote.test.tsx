import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { useQuote, type Quote } from '../useQuote'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body } as Response)

// The quote the hook gives once the endpoint answered `body`.
async function quoteOf(symbol: string, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(() => ok(body)))
  const seen: { quote: Quote | null } = { quote: null }
  const Probe = () => { seen.quote = useQuote(symbol); return null }
  const root = createRoot(document.createElement('div'))
  await act(async () => { root.render(<Probe />) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  act(() => root.unmount())
  return seen.quote
}

afterEach(() => vi.unstubAllGlobals())

// odd/tasks/extended-hours.md S2: the chart's pre- or post-market price comes with the page's one quote poll.
describe('useQuote — extended hours', () => {
  it("carries a stock's pre- or post-market price, its % a fraction like the day's", async () => {
    const quote = await quoteOf('SPY', [{ ticker: 'SPY', price: 140, change_pct: 1.5, extended: { session: 'post', price: 138, change_pct: -1.25 } }])

    expect(quote).toEqual({ price: 140, changePct: 0.015, extended: { session: 'post', price: 138, changePct: -0.0125 } })
  })

  it('none during the session, nor from a quote cached before it existed', async () => {
    expect((await quoteOf('SPY', [{ ticker: 'SPY', price: 140, change_pct: 1.5, extended: null }]))?.extended).toBeNull()
    expect((await quoteOf('SPY', [{ ticker: 'SPY', price: 140, change_pct: 1.5 }]))?.extended).toBeNull()
  })

  it('none for a coin', async () => {
    const quote = await quoteOf('BTCUSDT', { symbol: 'BTCUSDT', lastPrice: '80000', priceChangePercent: '2' })

    expect(quote).toEqual({ price: 80000, changePct: 0.02, extended: null })
  })
})
