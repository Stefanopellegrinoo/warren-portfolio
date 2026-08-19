import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Quote } from '@/types'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockLoadUserPortfolios = vi.fn()
vi.mock('../user-portfolios', () => ({
  loadUserPortfolios: () => mockLoadUserPortfolios(),
}))

const mockUpsert = vi.fn()
const mockFrom = vi.fn(() => ({ upsert: mockUpsert }))
vi.mock('../supabase-server', () => ({
  createServiceClient: () => ({ from: mockFrom }),
}))

// snapshotUser fetches its own quotes — keep that off the network so these
// tests assert valuation logic, not Redis/Yahoo availability.
const mockFetchQuotes = vi.fn()
vi.mock('../yahoo-finance', () => ({
  fetchQuotes: (...args: unknown[]) => mockFetchQuotes(...args),
}))

const { snapshotAllUsers, buildSnapshotRow } = await import('../portfolio-snapshots')

// ── Helpers ──────────────────────────────────────────────────────────────────

function quote(ticker: string, price: number): Quote {
  return { ticker, price, change: 0, changePercent: 0, previousClose: price }
}

const DATE = '2026-07-23'

beforeEach(() => {
  vi.clearAllMocks()
  mockUpsert.mockResolvedValue({ error: null })
  mockLoadUserPortfolios.mockResolvedValue([])
  mockFetchQuotes.mockResolvedValue(new Map())
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('snapshotAllUsers', () => {
  it('writes a snapshot row covering stocks, ONs and cash', async () => {
    // Arrange — 10 AAPL @ 20 (invested 150) + 5 MGCRD @ 10 (invested 40) + 100 cash
    mockLoadUserPortfolios.mockResolvedValue([
      {
        userId: 'u1',
        positions: [{ ticker: 'AAPL', quantity: 10, total_invested: 150, avg_cost: 15 }],
        onPositions: [{ ticker: 'MGCRD', quantity: 5, total_invested: 40, avg_cost: 8 }],
        realized: 0,
        onRealized: 0,
        cashBalance: 100,
      },
    ])
    const stockQuotes = new Map([['AAPL', quote('AAPL', 20)]])
    const onQuotes = new Map([['MGCRD', quote('MGCRD', 10)]])

    // Act
    const result = await snapshotAllUsers(stockQuotes, onQuotes, DATE)

    // Assert — cash IS part of total_value; invested excludes it
    expect(mockFrom).toHaveBeenCalledWith('portfolio_snapshots')
    const [row] = mockUpsert.mock.calls[0]
    expect(row).toMatchObject({
      user_id: 'u1',
      snapshot_date: DATE,
      total_value: 200 + 50 + 100,
      total_invested: 190,
    })
    expect(row.pnl).toBeCloseTo(60)
    expect(row.pnl_pct).toBeCloseTo(60 / 190)
    expect(result.written).toBe(1)
  })

  it('upserts on user_id + snapshot_date so re-running the same day is idempotent', async () => {
    // Arrange
    mockLoadUserPortfolios.mockResolvedValue([
      { userId: 'u1', positions: [], onPositions: [], realized: 0, onRealized: 0, cashBalance: 50 },
    ])

    // Act
    await snapshotAllUsers(new Map(), new Map(), DATE)

    // Assert — without this the job would insert duplicates on every retry
    expect(mockUpsert.mock.calls[0][1]).toEqual({ onConflict: 'user_id,snapshot_date' })
  })

  it('snapshots a cash-only user with zero invested without dividing by zero', async () => {
    // Arrange
    mockLoadUserPortfolios.mockResolvedValue([
      { userId: 'u1', positions: [], onPositions: [], realized: 0, onRealized: 0, cashBalance: 500 },
    ])

    // Act
    const result = await snapshotAllUsers(new Map(), new Map(), DATE)

    // Assert
    const [row] = mockUpsert.mock.calls[0]
    expect(row.total_value).toBe(500)
    expect(row.total_invested).toBe(0)
    expect(row.pnl_pct).toBe(0)
    expect(Number.isFinite(row.pnl_pct)).toBe(true)
    expect(result.written).toBe(1)
  })

  it('keeps snapshotting the remaining users when one write fails', async () => {
    // Arrange — a single bad row must not cost every other user their snapshot
    mockLoadUserPortfolios.mockResolvedValue([
      { userId: 'u1', positions: [], onPositions: [], realized: 0, onRealized: 0, cashBalance: 10 },
      { userId: 'u2', positions: [], onPositions: [], realized: 0, onRealized: 0, cashBalance: 20 },
    ])
    mockUpsert.mockResolvedValueOnce({ error: { message: 'constraint violation' } })

    // Act
    const result = await snapshotAllUsers(new Map(), new Map(), DATE)

    // Assert
    expect(mockUpsert).toHaveBeenCalledTimes(2)
    expect(result.written).toBe(1)
    expect(result.failed).toBe(1)
  })

  it('does nothing when there are no users', async () => {
    // Act
    const result = await snapshotAllUsers(new Map(), new Map(), DATE)

    // Assert
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(result).toEqual({ written: 0, failed: 0 })
  })

  it('still records a snapshot when quotes are missing, falling back to avg cost', async () => {
    // Arrange — market data outage: no quote for the held ticker
    mockLoadUserPortfolios.mockResolvedValue([
      {
        userId: 'u1',
        positions: [{ ticker: 'AAPL', quantity: 10, total_invested: 150, avg_cost: 15 }],
        onPositions: [],
        realized: 0,
        onRealized: 0,
        cashBalance: 0,
      },
    ])

    // Act
    const result = await snapshotAllUsers(new Map(), new Map(), DATE)

    // Assert — a gap in the drawdown series is worse than a cost-based valuation
    expect(result.written).toBe(1)
    const [row] = mockUpsert.mock.calls[0]
    expect(row.total_value).toBeGreaterThan(0)
  })
})

describe('splitQuotesByAssetClass', () => {
  it('classifies a stock whose ticker ends in D as a stock, not an ON', async () => {
    // Arrange — JD (JD.com) is a real CEDEAR the portfolio holds. Classifying by
    // the "D" suffix would route it to Data912 pricing and drop it from the
    // stock totals entirely.
    const { splitQuotesByAssetClass } = await import('../portfolio-snapshots')
    const all = new Map([
      ['JD', quote('JD', 42)],
      ['MGCRD', quote('MGCRD', 100)],
    ])

    // Act — ON membership comes from the ON tables, not from the name
    const { stockQuotes, onQuotes } = splitQuotesByAssetClass(all, ['MGCRD'])

    // Assert
    expect(stockQuotes.has('JD')).toBe(true)
    expect(onQuotes.has('JD')).toBe(false)
    expect(onQuotes.has('MGCRD')).toBe(true)
    expect(stockQuotes.has('MGCRD')).toBe(false)
  })

  it('matches ON membership case-insensitively', async () => {
    // Arrange
    const { splitQuotesByAssetClass } = await import('../portfolio-snapshots')
    const all = new Map([['cs50d', quote('cs50d', 104)]])

    // Act
    const { stockQuotes, onQuotes } = splitQuotesByAssetClass(all, [' CS50D '])

    // Assert — the quote keeps its original casing but lands in the ON bucket
    expect(onQuotes.has('cs50d')).toBe(true)
    expect(stockQuotes.size).toBe(0)
  })

  it('treats an unknown ticker as a stock', async () => {
    // Arrange
    const { splitQuotesByAssetClass } = await import('../portfolio-snapshots')
    const all = new Map([['AAPL', quote('AAPL', 200)]])

    // Act
    const { stockQuotes, onQuotes } = splitQuotesByAssetClass(all, [])

    // Assert
    expect(stockQuotes.has('AAPL')).toBe(true)
    expect(onQuotes.size).toBe(0)
  })
})

describe('snapshotAllUsers — asset class routing', () => {
  it('values a D-suffixed stock at its market price, not at cost', async () => {
    // Arrange — JD held as a stock, priced by Yahoo
    mockLoadUserPortfolios.mockResolvedValue([
      {
        userId: 'u1',
        positions: [{ ticker: 'JD', quantity: 10, total_invested: 100, avg_cost: 10 }],
        onPositions: [],
        realized: 0,
        onRealized: 0,
        cashBalance: 0,
      },
    ])

    // Act — JD's quote correctly supplied in the stock map
    await snapshotAllUsers(new Map([['JD', quote('JD', 42)]]), new Map(), DATE)

    // Assert — 10 × 42 market, NOT 10 × 10 cost
    const [row] = mockUpsert.mock.calls[0]
    expect(row.total_value).toBe(420)
    expect(row.pnl).toBe(320)
  })
})

describe('withCostFallback via snapshotAllUsers — degenerate quotes', () => {
  it('marks a position at cost when its quote is priced at zero', async () => {
    // Arrange — a 0 price is "no price", not a worthless holding
    mockLoadUserPortfolios.mockResolvedValue([
      {
        userId: 'u1',
        positions: [{ ticker: 'AAPL', quantity: 10, total_invested: 150, avg_cost: 15 }],
        onPositions: [],
        realized: 0,
        onRealized: 0,
        cashBalance: 0,
      },
    ])

    // Act
    await snapshotAllUsers(new Map([['AAPL', quote('AAPL', 0)]]), new Map(), DATE)

    // Assert — 10 × 15 cost, and invested is NOT silently dropped
    const [row] = mockUpsert.mock.calls[0]
    expect(row.total_value).toBe(150)
    expect(row.total_invested).toBe(150)
  })
})

describe('snapshotUser', () => {
  const single = vi.fn()
  const userUpsert = vi.fn(() => ({ select: () => ({ single }) }))

  function clientWith(tables: Record<string, any[]>) {
    return {
      from: vi.fn((table: string) => {
        if (table === 'portfolio_snapshots') return { upsert: userUpsert }
        return { select: () => ({ eq: () => ({ data: tables[table] ?? [], error: null }) }) }
      }),
    }
  }

  beforeEach(() => {
    single.mockResolvedValue({ data: { id: 'snap-1' }, error: null })
    userUpsert.mockClear()
  })

  it('refuses to snapshot a user with no positions and no cash', async () => {
    // Arrange
    const { snapshotUser } = await import('../portfolio-snapshots')
    const supabase = clientWith({})

    // Act
    const result = await snapshotUser(supabase, 'u1', DATE)

    // Assert — nothing to record, and no empty row written
    expect(result).toEqual({ ok: false, error: 'Nothing to snapshot', status: 400 })
    expect(userUpsert).not.toHaveBeenCalled()
  })

  it('snapshots a cash-only user', async () => {
    // Arrange
    const { snapshotUser } = await import('../portfolio-snapshots')
    const supabase = clientWith({ cash_balance: [{ balance: 300 }] })

    // Act
    const result = await snapshotUser(supabase, 'u1', DATE)

    // Assert
    expect(result).toEqual({ ok: true, snapshot: { id: 'snap-1' } })
    const [row] = userUpsert.mock.calls[0] as any[]
    expect(row).toMatchObject({ user_id: 'u1', snapshot_date: DATE, total_value: 300 })
  })

  it('subtracts a negative cash balance from total_value', async () => {
    // Arrange — real data has users whose cash went negative
    const { snapshotUser } = await import('../portfolio-snapshots')
    const supabase = clientWith({
      positions: [{ ticker: 'AAPL', quantity: 10, total_invested: 100, avg_cost: 10 }],
      cash_balance: [{ balance: -60 }],
    })

    // Act
    const result = await snapshotUser(supabase, 'u1', DATE)

    // Assert — 10 × 10 (cost fallback, no quotes mocked) − 60
    expect(result.ok).toBe(true)
    const [row] = userUpsert.mock.calls[0] as any[]
    expect(row.total_value).toBe(40)
    expect(row.total_invested).toBe(100)
  })

  it('surfaces a write error instead of reporting success', async () => {
    // Arrange
    const { snapshotUser } = await import('../portfolio-snapshots')
    single.mockResolvedValue({ data: null, error: { message: 'rls denied' } })
    const supabase = clientWith({ cash_balance: [{ balance: 10 }] })

    // Act
    const result = await snapshotUser(supabase, 'u1', DATE)

    // Assert
    expect(result).toEqual({ ok: false, error: 'rls denied', status: 500 })
  })
})

describe('computeLiveSnapshotRow', () => {
  const upsert = vi.fn()

  function clientWith(tables: Record<string, any[]>) {
    return {
      from: vi.fn((table: string) => {
        if (table === 'portfolio_snapshots') return { upsert }
        return { select: () => ({ eq: () => ({ data: tables[table] ?? [], error: null }) }) }
      }),
    }
  }

  beforeEach(() => {
    upsert.mockClear()
  })

  it('returns null when there is nothing to value', async () => {
    // Arrange
    const { computeLiveSnapshotRow } = await import('../portfolio-snapshots')
    const supabase = clientWith({})

    // Act
    const row = await computeLiveSnapshotRow(supabase, 'u1', DATE)

    // Assert
    expect(row).toBeNull()
  })

  it('computes the row WITHOUT writing to portfolio_snapshots', async () => {
    // Arrange — 10 AAPL @ cost 10 (no quotes mocked → avg_cost fallback) + 50 cash
    const { computeLiveSnapshotRow } = await import('../portfolio-snapshots')
    const supabase = clientWith({
      positions: [{ ticker: 'AAPL', quantity: 10, total_invested: 100, avg_cost: 10 }],
      cash_balance: [{ balance: 50 }],
    })

    // Act
    const row = await computeLiveSnapshotRow(supabase, 'u1', DATE)

    // Assert — same valuation contract as snapshotUser, zero writes
    expect(row).toEqual({
      user_id: 'u1',
      snapshot_date: DATE,
      total_value: 150, // 10×10 cost fallback + 50 cash
      total_invested: 100,
      pnl: 0,
      pnl_pct: 0,
      // Per-asset-class breakdown (migration 034) — no ON held, no quote mocked.
      stocks_value: 100,
      stocks_invested: 100,
      ons_value: 0,
      ons_invested: 0,
      cash_value: 50,
    })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('values a cash-only user', async () => {
    // Arrange
    const { computeLiveSnapshotRow } = await import('../portfolio-snapshots')
    const supabase = clientWith({ cash_balance: [{ balance: 300 }] })

    // Act
    const row = await computeLiveSnapshotRow(supabase, 'u1', DATE)

    // Assert
    expect(row).toMatchObject({ snapshot_date: DATE, total_value: 300, total_invested: 0 })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('throws instead of returning an understated row when one query errors', async () => {
    // Arrange — positions select fails; on_positions/closed/cash all succeed.
    // Silently treating the failed read as "no positions" would understate
    // the snapshot and poison Max Drawdown once snapshotUser upserts it.
    const { computeLiveSnapshotRow } = await import('../portfolio-snapshots')
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'positions') {
          return { select: () => ({ eq: () => ({ data: null, error: { message: 'boom' } }) }) }
        }
        if (table === 'cash_balance') {
          return { select: () => ({ eq: () => ({ data: [{ balance: 50 }], error: null }) }) }
        }
        return { select: () => ({ eq: () => ({ data: [], error: null }) }) }
      }),
    }

    // Act / Assert — must reject, not resolve to null or an understated row
    await expect(computeLiveSnapshotRow(supabase, 'u1', DATE)).rejects.toThrow()
  })
})

describe('buildSnapshotRow — per-asset-class breakdown', () => {
  // A portfolio with one stock, one ON and cash, priced so every class is
  // distinguishable in the output.
  const portfolio = {
    userId: 'u1',
    positions: [{ ticker: 'AAPL', quantity: 10, avg_cost: 100, total_invested: 1000 }],
    onPositions: [{ ticker: 'MGCRD', quantity: 100, avg_cost: 50, total_invested: 5000 }],
    cashBalance: 2500,
    realized: 0,
    onRealized: 0,
  } as any

  const stockQuotes = new Map([
    ['AAPL', { ticker: 'AAPL', price: 120, change: 0, changePercent: 0, previousClose: 120 }],
  ]) as any
  const onQuotes = new Map([
    ['MGCRD', { ticker: 'MGCRD', price: 55, change: 0, changePercent: 0, previousClose: 55 }],
  ]) as any

  it('reports each class separately instead of only the total', () => {
    const row = buildSnapshotRow(portfolio, stockQuotes, onQuotes, '2026-07-29')

    expect(row.stocks_value).toBeCloseTo(1200, 6)     // 10 × 120
    expect(row.stocks_invested).toBeCloseTo(1000, 6)
    expect(row.ons_value).toBeCloseTo(5500, 6)        // 100 × 55
    expect(row.ons_invested).toBeCloseTo(5000, 6)
    expect(row.cash_value).toBeCloseTo(2500, 6)
  })

  it('keeps the value invariant: the parts sum to the total', () => {
    const row = buildSnapshotRow(portfolio, stockQuotes, onQuotes, '2026-07-29')

    expect(row.stocks_value + row.ons_value + row.cash_value).toBeCloseTo(row.total_value, 6)
  })

  it('keeps the invested invariant, which EXCLUDES cash by design', () => {
    // total_invested deliberately does not count the cash balance
    // (portfolio-snapshots.ts:46). Adding cash_value here would break it.
    const row = buildSnapshotRow(portfolio, stockQuotes, onQuotes, '2026-07-29')

    expect(row.stocks_invested + row.ons_invested).toBeCloseTo(row.total_invested, 6)
  })

  it('marks an unpriced ON at its own cost, never at zero', () => {
    // The missing-quote policy is 'avg_cost'. A zero here would burn a
    // fabricated crash into the reconstructed series.
    const row = buildSnapshotRow(portfolio, stockQuotes, new Map() as any, '2026-07-29')

    expect(row.ons_value).toBeCloseTo(5000, 6)
    expect(row.stocks_value + row.ons_value + row.cash_value).toBeCloseTo(row.total_value, 6)
  })
})
