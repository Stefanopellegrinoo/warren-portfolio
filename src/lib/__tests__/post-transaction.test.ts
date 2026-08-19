import { describe, it, expect, vi, beforeEach } from 'vitest'
import { postTransaction } from '../api/post-transaction'

const fetchMock = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = fetchMock as any
})

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
}

describe('postTransaction', () => {
  it('reports success on 201', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { id: 'tx-1' }))

    expect(await postTransaction({ ticker: 'NVDA' })).toEqual({ ok: true })
  })

  it('surfaces the resolved identity on 409 instead of treating it as an error', async () => {
    const resolution = {
      found: true,
      identity: { ticker: 'UN', yahooSymbol: 'UN', name: 'Corgi UNH 2x Daily ETF', exchange: 'Cboe US', price: 25.0261 },
    }
    fetchMock.mockResolvedValue(jsonResponse(409, { code: 'TICKER_UNCONFIRMED', resolution }))

    expect(await postTransaction({ ticker: 'UN' })).toEqual({
      ok: false,
      kind: 'needs-confirmation',
      resolution,
    })
  })

  it('reports a plain error for other failures', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { error: 'Could not verify the ticker right now. Try again shortly.' }))

    expect(await postTransaction({ ticker: 'NVDA' })).toEqual({
      ok: false,
      kind: 'error',
      message: 'Could not verify the ticker right now. Try again shortly.',
    })
  })

  it('sends confirmTicker through when asked to confirm', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, {}))

    await postTransaction({ ticker: 'UN', confirmTicker: true })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.confirmTicker).toBe(true)
  })

  it('carries the retroactive warning through on the success arm', async () => {
    const warning = {
      code: 'RETROACTIVE_ENTRY',
      entryDate: '2026-07-02',
      staleSnapshots: ['2026-07-23'],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 'tx-1', warnings: [warning] }),
    }))

    const result = await postTransaction({ ticker: 'DNCBD' })

    expect(result).toEqual({ ok: true, warnings: [warning] })
  })

  it('reports ok with no warnings when the response carries none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 'tx-1' }),
    }))

    const result = await postTransaction({ ticker: 'AAPL' })

    expect(result).toEqual({ ok: true, warnings: undefined })
  })
})
