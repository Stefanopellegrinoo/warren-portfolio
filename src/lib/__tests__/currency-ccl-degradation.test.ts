/**
 * getHistoricalCCL × the REAL fetchHistoricalQuotes.
 *
 * ── The architectural break this file pins ─────────────────────────────────
 *
 * `getHistoricalCCL` (currency.ts:63) bootstraps the CCL series by calling
 * `fetchHistoricalQuotes('BCBA:GGAL', …)` and then computing
 * `CCL = (local × 10) / adr` — a formula that only makes sense if the local leg
 * is still in ARS.
 *
 * But `fetchHistoricalQuotes` is the very function that converts `BCBA:` prices
 * to USD, and it does so by calling `getHistoricalCCL`. So the bootstrap asks
 * the normalising function for a raw price, and in doing so calls itself:
 *
 *     getHistoricalCCL → fetchHistoricalQuotes('BCBA:GGAL') → getHistoricalCCL → …
 *
 * Nothing breaks that cycle from the inside. Neither cache can: the Redis write
 * in `fetchHistoricalQuotes` happens after its own recursive read, and
 * `getHistoricalCCL` only caches when `rates.size > 0`, which never holds on
 * this path. The recursion bottoms out only when the outermost transport call
 * fails — which is exactly why the stub below caps Yahoo after a few calls.
 * Without that cap this test never terminates, and neither would production.
 *
 * The one mercy: since this branch, `fetchHistoricalQuotes` THROWS on a missing
 * rate instead of leaving the price in pesos. So the recursion unwinds into an
 * empty Map rather than into a confidently wrong rate ~1000× off. That is the
 * honest current contract, and it is what these tests assert.
 *
 * ── Why this is dormant ───────────────────────────────────────────────────
 *
 * No `BCBA:` ticker exists in this database, so nothing reaches
 * `getHistoricalCCL` today. Both mocked-`../currency` CCL suites elsewhere stub
 * this interaction away entirely, which is why 607 green tests never saw it.
 *
 * ── What a future fix must do ─────────────────────────────────────────────
 *
 * The bootstrap must fetch its local leg RAW — a historical sibling of
 * `fetchRawQuotes`, which is precisely how the spot path (`getCCLRate`) already
 * avoids this cycle. Until then, these tests pin the current behaviour: no
 * fabricated rate, nothing cached, and a cycle that only a transport failure
 * ends. They all PASS as written; a real fix is expected to change them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/** Every Yahoo symbol asked for, in order. */
const yahooCalls: string[] = []

/**
 * The recursion terminator. `getHistoricalCCL` re-enters itself once per level,
 * asking for `GGAL.BA` each time; after this many asks the stub fails the way a
 * hammered upstream eventually would. This cap is not test convenience — it is
 * the only thing that ends the cycle.
 */
const YAHOO_BCBA_CALL_CAP = 3

const ADR_CLOSE = 50      // GGAL in USD
const LOCAL_CLOSE = 5000  // GGAL.BA in ARS — the raw price the formula needs
const THE_DATE = '2024-01-15'

const redisGet = vi.fn(async (_key: string): Promise<string | null> => null)
const redisSetex = vi.fn(async (_key: string, _ttl: number, _value: string) => 'OK')
const redisSet = vi.fn(async (_key: string, _value: string) => 'OK')

vi.mock('../redis', () => ({
  getRedis: () => ({ get: redisGet, setex: redisSetex, set: redisSet }),
  isRedisReady: () => true,
  ensureRedisConnected: async () => false,
  // The route cache in yahoo-finance.ts: always a miss, which is the degraded
  // state that matters. A hit would only postpone the same cycle.
  getCachedRoute: async () => null,
  cacheRoute: async () => undefined,
}))

vi.mock('yahoo-finance2', () => {
  class FakeYahoo {
    suppressNotices() {}
    async historical(symbol: string) {
      yahooCalls.push(symbol)
      if (yahooCalls.filter((s) => s === 'GGAL.BA').length >= YAHOO_BCBA_CALL_CAP) {
        throw new Error('network unreachable')
      }
      return [
        {
          date: new Date(`${THE_DATE}T00:00:00Z`),
          close: symbol === 'GGAL.BA' ? LOCAL_CLOSE : ADR_CLOSE,
        },
      ]
    }
  }
  return { default: FakeYahoo }
})

const START = new Date('2024-01-01')
const END = new Date('2024-01-15')

beforeEach(async () => {
  yahooCalls.length = 0
  vi.clearAllMocks()
  redisGet.mockResolvedValue(null)
  // Warm the yahoo-finance singleton BEFORE the act. getHistoricalCCL fires its
  // two legs through Promise.all, and two concurrent `await import()` calls race
  // on the module mock — one leg would otherwise reach the real library and hit
  // the network. Warming makes the run hermetic and deterministic.
  const { getYahooFinanceInstance } = await import('../yahoo-finance')
  await getYahooFinanceInstance()
})

describe('getHistoricalCCL — CHARACTERIZATION: current (broken) behaviour, not a specification', () => {
  // IMPORTANT: Red tests below may mean the architectural fix (fetching the local leg RAW)
  // has landed and these characterization tests need rewriting, not that something broke.

  it('today returns an empty Map rather than a fabricated rate', async () => {
    const { getHistoricalCCL } = await import('../currency')

    const rates = await getHistoricalCCL(START, END)

    expect(rates.size).toBe(0)
    // Both rates the broken formula could have produced are absent:
    // (raw ARS × 10) / adr = 1000, and (USD-normalised × 10) / adr = anything else.
    expect(rates.get(THE_DATE)).toBeUndefined()
    expect([...rates.values()]).toEqual([])
  })

  it('today does not cache the empty result, so a later call retries', async () => {
    const { getHistoricalCCL } = await import('../currency')

    const first = await getHistoricalCCL(START, END)
    expect(first.size).toBe(0)

    // Nothing was written under the historical-CCL key — an empty map cached for
    // 24h would keep every BCBA price wrong for a day after the outage ended.
    const cachedKeys = redisSetex.mock.calls.map(([key]) => key)
    expect(cachedKeys.filter((k) => k.startsWith('currency:h-ccl:'))).toEqual([])

    // And the retry really re-fetches instead of serving a memoised empty map.
    const callsAfterFirst = yahooCalls.length
    yahooCalls.length = 0
    const second = await getHistoricalCCL(START, END)

    expect(callsAfterFirst).toBeGreaterThan(0)
    expect(yahooCalls.length).toBeGreaterThan(0)
    expect(second.size).toBe(0)
  })

  it('today CCL is not computed from a USD-normalised local leg', async () => {
    const { getHistoricalCCL } = await import('../currency')

    const rates = await getHistoricalCCL(START, END)

    // The local leg WAS requested through the normalising function — that is the
    // architectural break, and it is why this test exists.
    expect(yahooCalls).toContain('GGAL.BA')
    // Yahoo really did hand back a raw ARS close for that date...
    const rawRate = (LOCAL_CLOSE * 10) / ADR_CLOSE // 1000 — the correct answer
    // ...and yet no rate comes out at all, because the normalising leg refuses
    // to return a price it could not convert. An empty Map is the honest answer;
    // any number here would have been computed from an already-divided close.
    expect(rates.size).toBe(0)
  })

  it('today the bootstrap re-enters itself: it asks the normalising function for its own input', async () => {
    const { getHistoricalCCL } = await import('../currency')

    await getHistoricalCCL(START, END)

    // More than one GGAL.BA fetch per call can only come from re-entry. This is
    // the cycle described at the top of this file, pinned so a future fix that
    // makes the bootstrap fetch RAW has to come back and delete this test.
    const bcbaCalls = yahooCalls.filter((s) => s === 'GGAL.BA').length
    expect(bcbaCalls).toBeGreaterThan(1)
    expect(bcbaCalls).toBe(YAHOO_BCBA_CALL_CAP)
  })
})
