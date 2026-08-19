import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getCataloguedTicker,
  listCatalogued,
  upsertTickerIdentity,
  stampChecked,
  UNRESOLVED_NAME,
} from '../ticker-catalog'
// Note: no vi.mock here — these functions take the Supabase client as an
// argument, so a plain stub exercises the real implementation.

/**
 * `select()` has to serve two shapes: `.eq().maybeSingle()` for a single-row
 * read, and a directly-awaited result for the list read. Returning a thenable
 * that also carries `.eq` covers both without two separate stubs.
 */
function makeSupabase(overrides: Record<string, any> = {}) {
  const state: any = { upserted: null, updated: null, updateFilter: null }
  const listResult = overrides.list ?? { data: [], error: null }
  const singleResult = overrides.single ?? { data: null, error: null }

  const supabase = {
    state,
    from: () => ({
      select: () => {
        const selection: any = {
          eq: (_col: string, val: string) => {
            state.selectedTicker = val
            return { maybeSingle: async () => singleResult }
          },
          then: (resolve: (v: any) => void) => resolve(listResult),
        }
        return selection
      },
      upsert: async (row: any) => {
        state.upserted = row
        return overrides.upsertResult ?? { error: null }
      },
      update: (patch: any) => ({
        eq: async (_col: string, val: string) => {
          state.updated = patch
          state.updateFilter = val
          return { error: null }
        },
      }),
    }),
  }
  return supabase as any
}

beforeEach(() => vi.clearAllMocks())

describe('getCataloguedTicker', () => {
  it('returns the row when the ticker is catalogued', async () => {
    const row = { ticker: 'NVDA', yahoo_symbol: 'NVDA', confirmed_name: 'NVIDIA Corporation', exchange: 'NasdaqGS', last_checked_at: null }
    const supabase = makeSupabase({ single: { data: row, error: null } })

    expect(await getCataloguedTicker(supabase, 'NVDA')).toEqual(row)
  })

  it('returns null when the ticker is absent', async () => {
    const supabase = makeSupabase({ single: { data: null, error: null } })

    expect(await getCataloguedTicker(supabase, 'NOPE')).toBeNull()
  })

  it('uppercases the lookup so casing never creates a false miss', async () => {
    const row = { ticker: 'NVDA', yahoo_symbol: 'NVDA', confirmed_name: 'NVIDIA Corporation', exchange: null, last_checked_at: null }
    const supabase = makeSupabase({ single: { data: row, error: null } })

    expect(await getCataloguedTicker(supabase, ' nvda ')).toEqual(row)
    expect(supabase.state.selectedTicker).toBe('NVDA')
  })

  it('throws when the read itself fails, rather than reporting "not catalogued"', async () => {
    const supabase = makeSupabase({ single: { data: null, error: { message: 'connection reset' } } })

    await expect(getCataloguedTicker(supabase, 'NVDA')).rejects.toThrow('connection reset')
  })
})

describe('listCatalogued', () => {
  it('returns every catalogued row', async () => {
    const rows = [
      { ticker: 'NVDA', yahoo_symbol: 'NVDA', confirmed_name: 'NVIDIA Corporation', exchange: 'NasdaqGS', last_checked_at: null },
      { ticker: 'SPY', yahoo_symbol: 'SPY', confirmed_name: 'State Street SPDR S&P 500 ETF Trust', exchange: 'NYSEArca', last_checked_at: null },
    ]
    const supabase = makeSupabase({ list: { data: rows, error: null } })

    expect(await listCatalogued(supabase)).toEqual(rows)
  })

  it('returns an empty array when the catalog is empty', async () => {
    const supabase = makeSupabase({ list: { data: null, error: null } })

    expect(await listCatalogued(supabase)).toEqual([])
  })

  it('throws when the read fails, so an audit never mistakes an outage for an empty catalog', async () => {
    const supabase = makeSupabase({ list: { data: null, error: { message: 'timeout' } } })

    await expect(listCatalogued(supabase)).rejects.toThrow('timeout')
  })
})

describe('upsertTickerIdentity', () => {
  it('writes the resolved identity', async () => {
    const supabase = makeSupabase()
    await upsertTickerIdentity(
      supabase,
      { found: true, identity: { ticker: 'NVDA', yahooSymbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NasdaqGS', price: 206.84 } },
      'NVDA'
    )

    expect(supabase.state.upserted).toMatchObject({
      ticker: 'NVDA',
      yahoo_symbol: 'NVDA',
      confirmed_name: 'NVIDIA Corporation',
      exchange: 'NasdaqGS',
    })
  })

  it('still writes a row for an unresolvable ticker so it is not re-prompted forever', async () => {
    const supabase = makeSupabase()
    await upsertTickerIdentity(supabase, { found: false, reason: 'not-found' }, 'MYTHING')

    expect(supabase.state.upserted).toMatchObject({
      ticker: 'MYTHING',
      confirmed_name: UNRESOLVED_NAME,
      exchange: null,
    })
  })

  it('throws when the write fails, so the catalog can never fall behind transactions', async () => {
    const supabase = makeSupabase({ upsertResult: { error: { message: 'permission denied' } } })

    await expect(
      upsertTickerIdentity(supabase, { found: false, reason: 'not-found' }, 'X')
    ).rejects.toThrow('permission denied')
  })
})

describe('stampChecked', () => {
  it('updates only last_checked_at and never confirmed_name', async () => {
    const supabase = makeSupabase()
    await stampChecked(supabase, 'NVDA', '2026-07-27T00:00:00.000Z')

    expect(supabase.state.updated).toEqual({ last_checked_at: '2026-07-27T00:00:00.000Z' })
    expect(supabase.state.updated).not.toHaveProperty('confirmed_name')
    expect(supabase.state.updateFilter).toBe('NVDA')
  })
})
