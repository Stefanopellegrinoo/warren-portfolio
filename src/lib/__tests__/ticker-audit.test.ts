import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockResolve = vi.fn()
vi.mock('../ticker-identity', () => ({ resolveTickerIdentity: (...a: unknown[]) => mockResolve(...a) }))

const mockListCatalogued = vi.fn()
const mockStampChecked = vi.fn()
vi.mock('../ticker-catalog', () => ({
  listCatalogued: (...a: unknown[]) => mockListCatalogued(...a),
  stampChecked: (...a: unknown[]) => mockStampChecked(...a),
}))

/** Supabase stub serving only the `positions` table. */
function supabaseWithPositions(tickers: string[]) {
  return {
    from: (table: string) => {
      if (table !== 'positions') throw new Error(`unexpected table ${table}`)
      return { select: async () => ({ data: tickers.map(t => ({ ticker: t })), error: null }) }
    },
  } as any
}

const NOW = '2026-07-27T03:00:00.000Z'

beforeEach(() => {
  vi.clearAllMocks()
  mockStampChecked.mockResolvedValue(undefined)
})

describe('auditTickerIdentities', () => {
  it('flags an open position with no catalog row', async () => {
    const { auditTickerIdentities } = await import('../ticker-audit')
    mockListCatalogued.mockResolvedValue([])

    const findings = await auditTickerIdentities(supabaseWithPositions(['GHOST']), NOW)

    expect(findings).toEqual([{ kind: 'UNCATALOGUED', ticker: 'GHOST' }])
  })

  it('flags a catalogued ticker whose instrument changed', async () => {
    const { auditTickerIdentities } = await import('../ticker-audit')
    mockListCatalogued.mockResolvedValue([
      { ticker: 'ABC', yahoo_symbol: 'ABC', confirmed_name: 'Old Company Inc.', exchange: null, last_checked_at: null },
    ])
    mockResolve.mockResolvedValue({
      found: true,
      identity: { ticker: 'ABC', yahooSymbol: 'ABC', name: 'Totally Different Corp.', exchange: null, price: 10 },
    })

    const findings = await auditTickerIdentities(supabaseWithPositions(['ABC']), NOW)

    expect(findings).toEqual([
      { kind: 'IDENTITY_DRIFT', ticker: 'ABC', confirmed: 'Old Company Inc.', current: 'Totally Different Corp.' },
    ])
  })

  it('stamps last_checked_at and reports nothing when the identity still matches', async () => {
    const { auditTickerIdentities } = await import('../ticker-audit')
    mockListCatalogued.mockResolvedValue([
      { ticker: 'NVDA', yahoo_symbol: 'NVDA', confirmed_name: 'NVIDIA Corporation', exchange: 'NasdaqGS', last_checked_at: null },
    ])
    mockResolve.mockResolvedValue({
      found: true,
      identity: { ticker: 'NVDA', yahooSymbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NasdaqGS', price: 206.84 },
    })

    const findings = await auditTickerIdentities(supabaseWithPositions(['NVDA']), NOW)

    expect(findings).toEqual([])
    expect(mockStampChecked).toHaveBeenCalledWith(expect.anything(), 'NVDA', NOW)
  })

  it('does not flag drift when Yahoo simply has no price today', async () => {
    const { auditTickerIdentities } = await import('../ticker-audit')
    mockListCatalogued.mockResolvedValue([
      { ticker: 'THIN', yahoo_symbol: 'THIN', confirmed_name: 'Thinly Traded Inc.', exchange: null, last_checked_at: null },
    ])
    mockResolve.mockResolvedValue({ found: false, reason: 'no-price' })

    expect(await auditTickerIdentities(supabaseWithPositions(['THIN']), NOW)).toEqual([])
  })

  it('never rewrites confirmed_name — drift is for a human to resolve', async () => {
    const { auditTickerIdentities } = await import('../ticker-audit')
    mockListCatalogued.mockResolvedValue([
      { ticker: 'ABC', yahoo_symbol: 'ABC', confirmed_name: 'Old Company Inc.', exchange: null, last_checked_at: null },
    ])
    mockResolve.mockResolvedValue({
      found: true,
      identity: { ticker: 'ABC', yahooSymbol: 'ABC', name: 'Totally Different Corp.', exchange: null, price: 10 },
    })

    await auditTickerIdentities(supabaseWithPositions(['ABC']), NOW)

    expect(mockStampChecked).not.toHaveBeenCalled()
  })

  it('skips a ticker whose resolution throws instead of failing the whole audit', async () => {
    const { auditTickerIdentities } = await import('../ticker-audit')
    mockListCatalogued.mockResolvedValue([
      { ticker: 'A', yahoo_symbol: 'A', confirmed_name: 'A Corp', exchange: null, last_checked_at: null },
      { ticker: 'B', yahoo_symbol: 'B', confirmed_name: 'B Corp', exchange: null, last_checked_at: null },
    ])
    mockResolve
      .mockRejectedValueOnce(new Error('yahoo down'))
      .mockResolvedValueOnce({
        found: true,
        identity: { ticker: 'B', yahooSymbol: 'B', name: 'Different B', exchange: null, price: 1 },
      })

    const findings = await auditTickerIdentities(supabaseWithPositions(['A', 'B']), NOW)

    expect(findings).toEqual([
      { kind: 'IDENTITY_DRIFT', ticker: 'B', confirmed: 'B Corp', current: 'Different B' },
    ])
  })

  it('only audits tickers that are actually held', async () => {
    const { auditTickerIdentities } = await import('../ticker-audit')
    mockListCatalogued.mockResolvedValue([
      { ticker: 'CLOSED', yahoo_symbol: 'CLOSED', confirmed_name: 'Closed Co', exchange: null, last_checked_at: null },
    ])

    const findings = await auditTickerIdentities(supabaseWithPositions([]), NOW)

    expect(findings).toEqual([])
    expect(mockResolve).not.toHaveBeenCalled()
  })
})
