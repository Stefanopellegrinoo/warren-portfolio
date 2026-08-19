/**
 * Ticker identity resolution.
 *
 * Answers "what instrument does Yahoo think this symbol is?" so a human can
 * confirm it before the app starts pricing a position with it. The failure this
 * guards against is not a missing price — it is a PRESENT price belonging to a
 * different company, which arrives well-formed and fools every other check.
 *
 * Resolution only. Persistence lives in ticker-catalog.ts.
 */
import { normalizeTickerForYahoo, getYahooFinanceInstance } from './yahoo-finance'
import { getCachedRoute, cacheRoute } from './redis'

export interface TickerIdentity {
  ticker: string        // as the app stores it: uppercased, trimmed
  yahooSymbol: string   // what was actually asked of Yahoo
  name: string
  exchange: string | null
  price: number
}

export type ResolveResult =
  | { found: true; identity: TickerIdentity }
  | { found: false; reason: 'no-price' | 'not-found' }

/** An instrument's identity changes with corporate actions, not with the clock. */
export const TICKER_IDENTITY_TTL = 604800 // 7 days

/**
 * The single place that decides whether a thrown Yahoo error is an ANSWER or a
 * NON-ANSWER.
 *
 * "There is no such symbol" is a fact about the ticker and may be reported to
 * the user as `found: false`. A timeout, a DNS failure, a 429, an HTTP 5xx or a
 * module-load failure is a fact about the network — reporting it as "no
 * instrument found" invites the user to confirm it, which writes a permanent
 * `(no instrument found on Yahoo)` row for a real company. Design §9 is
 * explicit that this case must surface as a 503 with nothing written, and that
 * only happens if the error propagates.
 *
 * yahoo-finance2 signals an unknown or delisted symbol with a message
 * containing "No data found" — the library's own docs recommend exactly that
 * check (node_modules/yahoo-finance2/esm/src/modules/chart.js:112), and
 * market-data/providers/yahoo.ts already classifies on the same substring.
 *
 * The default direction is deliberate: anything unrecognised PROPAGATES.
 * Mistaking an outage for a real answer writes a wrong row that survives
 * forever; mistaking a real answer for an outage costs a 503 and a retry.
 */
export function isUnknownSymbolError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /no data found|no fundamentals data found|symbol may be delisted|quote not found/i.test(
    message
  )
}

export async function resolveTickerIdentity(ticker: string): Promise<ResolveResult> {
  const clean = ticker.toUpperCase().trim()
  const cacheKey = `ticker-identity:${clean}`

  const cached = await getCachedRoute<ResolveResult>(cacheKey)
  if (cached) return cached

  const yahooSymbol = normalizeTickerForYahoo(clean)

  let quote: any
  try {
    const yahoo = await getYahooFinanceInstance()
    quote = await yahoo.quote(yahooSymbol)
  } catch (err) {
    // A non-answer is not an answer. Let it out so callers can refuse to
    // proceed — the route turns this into a 503 and writes nothing.
    if (!isUnknownSymbolError(err)) throw err

    // Not cached: a symbol that fails today may be a typo corrected tomorrow,
    // and a 7-day negative cache would keep answering for the old mistake.
    return { found: false, reason: 'not-found' }
  }

  // Same bar fetchRawQuotes applies, so both agree on what "priceable" means.
  if (!quote?.regularMarketPrice) {
    return { found: false, reason: 'no-price' }
  }

  const result: ResolveResult = {
    found: true,
    identity: {
      ticker: clean,
      yahooSymbol,
      name: quote.longName ?? quote.shortName ?? yahooSymbol,
      exchange: quote.fullExchangeName ?? null,
      price: quote.regularMarketPrice,
    },
  }

  await cacheRoute(cacheKey, result, TICKER_IDENTITY_TTL)
  return result
}
