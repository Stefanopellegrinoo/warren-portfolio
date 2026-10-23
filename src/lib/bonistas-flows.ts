/**
 * Past ON payments from bonistas.com into `on_flow_history` (source 'bonistas').
 * BYMA lists future flows only and our own history starts 2026-10-20, so the past
 * (about 24 months, not every bond) comes from here. Values are per 100 original
 * VN, like BYMA's (`ren` already scaled to the residual, `amo` % of original).
 * Unofficial page with no API contract: the data sits in Next.js `__NEXT_DATA__`.
 * See odd/tasks/nucleo-ledger.md L9.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FlowRow } from './on-flow-history'

const PAGE_URL = 'https://bonistas.com/bono-cotizacion-rendimiento-precio-hoy/'
const FETCH_TIMEOUT_MS = 15_000

interface BonistasFlow { fecha: string; cupon: number; principal: number }

export function parseBonistasPastFlows(html: string): FlowRow[] {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) return []
  const past: BonistasFlow[] = JSON.parse(m[1])?.props?.pageProps?.bondData?.flow_past ?? []
  return past.map(f => ({ date: f.fecha.slice(0, 10), ren: Number(f.cupon) || 0, amo: Number(f.principal) || 0 }))
}

/** Inserts the past flows of one ISIN (its peso ticker); existing rows always win. THROWS on HTTP/DB failure. */
export async function backfillPastFlows(supabase: SupabaseClient, isin: string, tickerO: string, today: string): Promise<number> {
  const res = await fetch(PAGE_URL + encodeURIComponent(tickerO), {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`bonistas ${res.status} for ${tickerO}`)
  const rows = parseBonistasPastFlows(await res.text())
    .filter(f => f.date < today)
    .map(f => ({ isin, flow_date: f.date, ren: f.ren, amo: f.amo, first_seen_as_of: today, last_seen_as_of: today, source: 'bonistas' }))
  if (rows.length === 0) return 0
  const { error } = await supabase.from('on_flow_history').upsert(rows, { onConflict: 'isin,flow_date', ignoreDuplicates: true })
  if (error) throw new Error(`on_flow_history bonistas backfill failed: ${error.message}`)
  return rows.length
}
