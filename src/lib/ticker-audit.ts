/**
 * Weekly audit of the ticker identity catalog.
 *
 * Two findings, both advisory:
 *   UNCATALOGUED   — an open position whose ticker was never confirmed. The
 *                    bulk import produces these; it deliberately stays ungated.
 *   IDENTITY_DRIFT — a catalogued ticker Yahoo now reports as a different
 *                    instrument. Real markets reassign symbols after delistings.
 *
 * The audit NEVER rewrites confirmed_name. Silently re-confirming a drift would
 * defeat the entire mechanism — a human decides what a ticker is.
 */
import { resolveTickerIdentity } from './ticker-identity'
import { listCatalogued, stampChecked } from './ticker-catalog'

export type AuditFinding =
  | { kind: 'UNCATALOGUED'; ticker: string }
  | { kind: 'IDENTITY_DRIFT'; ticker: string; confirmed: string; current: string }

export async function auditTickerIdentities(
  supabase: any,
  now: string = new Date().toISOString()
): Promise<AuditFinding[]> {
  const { data: positions, error } = await supabase.from('positions').select('ticker')
  if (error) throw new Error(error.message)

  const held = Array.from(
    new Set((positions ?? []).map((p: any) => String(p.ticker).toUpperCase().trim()))
  ) as string[]

  const catalog = new Map((await listCatalogued(supabase)).map(r => [r.ticker.toUpperCase().trim(), r]))
  const findings: AuditFinding[] = []

  for (const ticker of held) {
    const row = catalog.get(ticker)
    if (!row) {
      findings.push({ kind: 'UNCATALOGUED', ticker })
      continue
    }

    let resolution
    try {
      resolution = await resolveTickerIdentity(ticker)
    } catch (err) {
      // Advisory job: a third party being down must not fail the queue.
      console.warn(`[TickerAudit] could not resolve ${ticker}:`, err)
      continue
    }

    // No price today is not evidence of a changed instrument.
    if (!resolution.found) continue

    if (resolution.identity.name !== row.confirmed_name) {
      findings.push({
        kind: 'IDENTITY_DRIFT',
        ticker,
        confirmed: row.confirmed_name,
        current: resolution.identity.name,
      })
      continue
    }

    await stampChecked(supabase, ticker, now)
  }

  return findings
}
