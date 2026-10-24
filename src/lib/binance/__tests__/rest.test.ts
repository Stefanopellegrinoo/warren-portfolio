import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCryptoQuotes } from '../rest'

const ticker = { symbol: 'BTCUSDT', lastPrice: '80513.28', priceChange: '-910.72', priceChangePercent: '-1.12' }

afterEach(() => vi.unstubAllGlobals())

describe('fetchCryptoQuotes', () => {
  it('reads the public market-data host and returns quotes keyed by symbol', async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify([ticker])))
    vi.stubGlobal('fetch', fetchMock)

    const quotes = await fetchCryptoQuotes(['BTCUSDT'])

    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/data-api\.binance\.vision\/api\/v3\/ticker\/24hr\?symbols=/)
    expect(quotes.get('BTCUSDT')).toMatchObject({
      ticker: 'BTCUSDT', price: 80513.28, change: -910.72, changePercent: expect.closeTo(-0.0112, 10), previousClose: 81424,
    })
  })

  it('falls back to Binance.US when the first host refuses the request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('restricted location', { status: 451 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([ticker])))
    vi.stubGlobal('fetch', fetchMock)

    const quotes = await fetchCryptoQuotes(['BTCUSDT'])

    expect(String(fetchMock.mock.calls[1][0])).toMatch(/^https:\/\/api\.binance\.us\/api\/v3\/ticker\/24hr\?symbols=/)
    expect(quotes.get('BTCUSDT')?.price).toBe(80513.28)
  })

  it('throws when every host fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 451 })))

    await expect(fetchCryptoQuotes(['BTCUSDT'])).rejects.toThrow('tickers 451')
  })
})
