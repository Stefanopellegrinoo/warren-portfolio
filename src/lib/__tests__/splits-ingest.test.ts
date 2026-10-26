import { describe, it, expect, vi } from 'vitest'
import { ingestSplits } from '../splits-ingest'
import type { BarsResult } from '../bars-cache'

type Row = Record<string, unknown>

/** transactions served in pages by `range`, stock_splits as stored, and the upserts received. */
function fakeDb({ trades = [] as Row[], stored = [] as Row[], upsertError = null as unknown } = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: upsertError })
  const from = vi.fn((table: string) => {
    const rows = table === 'transactions' ? trades : stored
    const b: any = {
      select: () => b,
      order: () => b,
      range: (f: number, t: number) => Promise.resolve({ data: rows.slice(f, Math.min(t + 1, f + 2)), error: null }),
      upsert,
    }
    return b
  })
  return { client: { from } as never, upsert }
}

const bars = (splits: BarsResult['splits'], splitsKnown = true): BarsResult => ({ bars: [], splits, splitsKnown, degraded: !splitsKnown, missing: false })

function deps(charts: Record<string, BarsResult>) {
  return {
    getBars: vi.fn(async (symbols: string[]) => new Map(symbols.map(s => [s, charts[s] ?? bars([], false)]))),
    listCatalogued: vi.fn(async () => [{ ticker: 'GOOGL', yahoo_symbol: 'GOOGL', confirmed_name: 'Alphabet', exchange: null, last_checked_at: null }]),
    invalidateUserCache: vi.fn(async (_userId: string) => {}),
    dropCachedSplits: vi.fn(async () => {}),
  }
}

const trades = [
  { ticker: 'GOOGL', date: '2022-03-21', user_id: 'a', asset_type: 'ACCION' },
  { ticker: 'googl ', date: '2026-07-24', user_id: 'b', asset_type: 'CEDEAR' },
  { ticker: 'BCBA:GGAL', date: '2023-01-02', user_id: 'b', asset_type: 'ACCION' },
  { ticker: 'YMCXO', date: '2020-01-02', user_id: 'a', asset_type: 'ON' },
]

describe('ingestSplits (odd/tasks/split-aware-ledger.md T2)', () => {
  it('stores the splits Yahoo reports for every traded stock, keyed by the ledger ticker, and refreshes who traded it', async () => {
    const db = fakeDb({ trades })
    const d = deps({ GOOGL: bars([{ date: '2022-07-18', numerator: 20, denominator: 1 }]), 'GGAL.BA': bars([]) })

    const result = await ingestSplits(db.client, d)

    // ONs have no splits; the first stock trade bounds the window; fresh from Yahoo, not today's cache.
    expect(d.getBars).toHaveBeenCalledWith(['GOOGL', 'GGAL.BA'], new Date('2022-03-21'), expect.objectContaining({ maxAgeSec: expect.any(Number) }))
    expect(db.upsert).toHaveBeenCalledTimes(1)
    expect(db.upsert.mock.calls[0][0]).toEqual([
      expect.objectContaining({ ticker: 'GOOGL', date: '2022-07-18', numerator: 20, denominator: 1, yahoo_symbol: 'GOOGL', source: 'yahoo' }),
    ])
    expect(db.upsert.mock.calls[0][1]).toEqual({ onConflict: 'ticker,date' })
    expect(d.dropCachedSplits).toHaveBeenCalledTimes(1)
    expect(d.invalidateUserCache.mock.calls.map(c => c[0]).sort()).toEqual(['a', 'b'])
    expect(result).toEqual({ tickers: 2, written: 1, unknown: [] })
  })

  it('writes nothing and refreshes nobody when every split is already stored; a corrected ratio is rewritten', async () => {
    const same = fakeDb({ trades, stored: [{ ticker: 'GOOGL', date: '2022-07-18', numerator: '20', denominator: '1' }] })
    const d = deps({ GOOGL: bars([{ date: '2022-07-18', numerator: 20, denominator: 1 }]), 'GGAL.BA': bars([]) })
    expect(await ingestSplits(same.client, d)).toEqual({ tickers: 2, written: 0, unknown: [] })
    expect(same.upsert).not.toHaveBeenCalled()
    expect(d.dropCachedSplits).not.toHaveBeenCalled()
    expect(d.invalidateUserCache).not.toHaveBeenCalled()

    const corrected = fakeDb({ trades, stored: [{ ticker: 'GOOGL', date: '2022-07-18', numerator: '2', denominator: '1' }] })
    expect((await ingestSplits(corrected.client, deps({ GOOGL: bars([{ date: '2022-07-18', numerator: 20, denominator: 1 }]), 'GGAL.BA': bars([]) }))).written).toBe(1)
  })

  it('a symbol whose splits are unknown keeps its stored rows and is reported', async () => {
    const db = fakeDb({ trades })
    const d = deps({ 'GGAL.BA': bars([]) })
    expect(await ingestSplits(db.client, d)).toEqual({ tickers: 2, written: 0, unknown: ['GOOGL'] })
    expect(db.upsert).not.toHaveBeenCalled()
  })

  it('a failed write throws, so the job fails and the table keeps its rows', async () => {
    const db = fakeDb({ trades, upsertError: { message: 'disk' } })
    await expect(ingestSplits(db.client, deps({ GOOGL: bars([{ date: '2022-07-18', numerator: 20, denominator: 1 }]), 'GGAL.BA': bars([]) })))
      .rejects.toThrow(/stock_splits/)
  })
})
