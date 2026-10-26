/**
 * Persistence for the ticker_identity catalog.
 *
 * Reads and writes only — no Yahoo access, so it can be tested against a plain
 * Supabase stub. Resolution lives in ticker-identity.ts.
 *
 * ticker_identity is a market table: anon/authenticated have no SELECT on it
 * (odd/tasks/security-hardening.md S12), so the reads use the service role and
 * ignore the client they are given (kept for callers).
 */
import type { ResolveResult } from './ticker-identity'
import { createServiceClient } from './supabase-server'
import { normalizeTickerForYahoo } from './yahoo-finance'

export interface CatalogRow {
  ticker: string
  yahoo_symbol: string
  confirmed_name: string
  exchange: string | null
  last_checked_at: string | null
}

/** Recorded for tickers with no Yahoo instrument, so they stop being re-prompted. */
export const UNRESOLVED_NAME = '(no instrument found on Yahoo)'

const COLUMNS = 'ticker, yahoo_symbol, confirmed_name, exchange, last_checked_at'

export async function getCataloguedTicker(_supabase: any, ticker: string): Promise<CatalogRow | null> {
  const clean = ticker.toUpperCase().trim()
  const { data, error } = await createServiceClient()
    .from('ticker_identity')
    .select(COLUMNS)
    .eq('ticker', clean)
    .maybeSingle()

  // A failed read is not the same as "not catalogued". Treating it as a miss
  // would prompt for confirmation on an already-confirmed ticker, and treating
  // it as a hit would wave through an unknown one.
  if (error) throw new Error(error.message)
  return (data as CatalogRow) ?? null
}

export async function listCatalogued(_supabase: any): Promise<CatalogRow[]> {
  const { data, error } = await createServiceClient().from('ticker_identity').select(COLUMNS)
  if (error) throw new Error(error.message)
  return (data ?? []) as CatalogRow[]
}

export async function upsertTickerIdentity(
  supabase: any,
  resolution: ResolveResult,
  ticker: string
): Promise<void> {
  const clean = ticker.toUpperCase().trim()
  const row = resolution.found
    ? {
        ticker: clean,
        yahoo_symbol: resolution.identity.yahooSymbol,
        confirmed_name: resolution.identity.name,
        exchange: resolution.identity.exchange,
      }
    : {
        ticker: clean,
        yahoo_symbol: clean,
        confirmed_name: UNRESOLVED_NAME,
        exchange: null,
      }

  const { error } = await supabase
    .from('ticker_identity')
    .upsert(row, { onConflict: 'ticker' })

  if (error) throw new Error(error.message)
}

/** Records that the audit verified this row. Never touches confirmed_name. */
export async function stampChecked(supabase: any, ticker: string, at: string): Promise<void> {
  const { error } = await supabase
    .from('ticker_identity')
    .update({ last_checked_at: at })
    .eq('ticker', ticker.toUpperCase().trim())

  if (error) throw new Error(error.message)
}

/** Which Yahoo symbol to ask for each ledger ticker: the confirmed one, else the exchange-normalized string. */
export function yahooSymbols(tickers: string[], catalog: CatalogRow[]): Map<string, string> {
  const confirmed = new Map(catalog.map(row => [row.ticker.trim().toUpperCase(), String(row.yahoo_symbol).trim()]))
  return new Map(tickers.map(t => [t, confirmed.get(t) ?? normalizeTickerForYahoo(t)]))
}
