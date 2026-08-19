/**
 * Persistence for the ticker_identity catalog.
 *
 * Reads and writes only — no Yahoo access, so it can be tested against a plain
 * Supabase stub. Resolution lives in ticker-identity.ts.
 */
import type { ResolveResult } from './ticker-identity'

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

export async function getCataloguedTicker(supabase: any, ticker: string): Promise<CatalogRow | null> {
  const clean = ticker.toUpperCase().trim()
  const { data, error } = await supabase
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

export async function listCatalogued(supabase: any): Promise<CatalogRow[]> {
  const { data, error } = await supabase.from('ticker_identity').select(COLUMNS)
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
