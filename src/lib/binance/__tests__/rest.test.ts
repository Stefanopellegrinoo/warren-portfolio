import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCryptoQuotes, fetchServerKlines } from '../rest'

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

describe('fetchServerKlines', () => {
  const kline = [1700000000000, '100', '110', '90', '105', '12.5']

  it('reads the public market-data host, which serves the worker\'s US server', async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify([kline])))
    vi.stubGlobal('fetch', fetchMock)

    const candles = await fetchServerKlines('btcusdt', '1h', 1000)

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1000')
    expect(candles).toEqual([{ time: 1700000000, open: 100, high: 110, low: 90, close: 105, volume: 12.5, isFinal: true }])
  })

  it('falls back to Binance.US when the first host refuses, and fails with the last answer when both do', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('restricted location', { status: 451 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([kline])))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchServerKlines('BTCUSDT', '1h')).toHaveLength(1)
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/^https:\/\/api\.binance\.us\/api\/v3\/klines\?symbol=BTCUSDT/)

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 400 })))
    await expect(fetchServerKlines('NOPEUSDT', '1h')).rejects.toThrow('klines 400')
  })
})
