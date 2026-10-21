// Nightly ON terms ingest: BYMA Educa -> adapter -> checks -> replace_on_terms RPC.
// Worker context: relative imports only. Keeps last-good by construction: every
// failure throws BEFORE the RPC, and the RPC is one transaction with its own guards.
import type { SupabaseClient } from '@supabase/supabase-js'
import { extractPayload, parseBymaPayload, type BymaResult } from './byma-educa'
import { computeYieldChecks, type YieldCheck } from './on-yield-checks'
import { resolveTerms, type OverrideRow } from './on-terms'

export const BYMA_URL = 'https://tablero.bymaeduca.com.ar/'
const FETCH_TIMEOUT_MS = 30_000
const MAX_HTML_BYTES = 20_000_000

export async function fetchBymaHtml(): Promise<string> {
  const res = await fetch(BYMA_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'user-agent': 'Mozilla/5.0 (compatible; warren-portfolio)' } })
  if (!res.ok) throw new Error(`BYMA Educa responded ${res.status}`)
  const text = await res.text()
  if (text.length > MAX_HTML_BYTES) throw new Error('BYMA Educa response too large')
  return text
}

export interface RpcArgs {
  p_as_of: string
  p_source: string
  p_terms: Record<string, unknown>[]
  p_flows: Record<string, unknown>[]
  p_checks: YieldCheck[]
  p_sov: Record<string, unknown>[] | null
}

// JSON keys are the snake_case column names (jsonb_populate_recordset).
export function toRpcArgs(res: BymaResult, checks: YieldCheck[]): RpcArgs {
  return {
    p_as_of: res.asOf,
    p_source: 'byma_educa',
    p_terms: res.ons.map((o) => ({
      isin: o.isin,
      ticker_o: o.tickerO,
      ticker_d: o.tickerD,
      ticker_c: o.tickerC,
      issuer: o.issuer,
      description: o.description,
      law: o.law,
      currency: o.currency,
      payment_plaza: o.paymentPlaza,
      est: o.est,
      frequency: o.frequency,
      issue_date: o.issueDate,
      maturity_date: o.maturityDate,
      coupon_rate: o.couponRate,
      residual_pct: o.residualPct,
      accrual_start: o.accrualStart,
      issued_amount_byma: o.issuedAmountByma,
      adtv_o: o.adtvO,
      adtv_d: o.adtvD,
      adtv_c: o.adtvC,
    })),
    p_flows: res.ons.flatMap((o) => o.flows.map((f) => ({ isin: o.isin, flow_date: f.date, ren: f.ren, amo: f.amo }))),
    p_checks: checks,
    p_sov: res.sovMissing ? null : res.sov.map((s) => ({ ticker: s.ticker, isin: s.isin, law: s.law, px: s.px, ytm: s.ytm, dm: s.dm })),
  }
}

export interface IngestSummary {
  asOf: string
  ons: number
  skipped: number
  sov: number
  checks: number
  flagged: number
  warnings: number
}

async function loadOverrides(supabase: SupabaseClient): Promise<OverrideRow[]> {
  const { data, error } = await supabase.from('on_terms_overrides').select('isin, field, value, source_url, verified_at')
  if (error) throw new Error(`on_terms_overrides read failed: ${error.message}`)
  return (data ?? []).map((r: any) => ({ isin: r.isin, field: r.field, value: r.value, sourceUrl: r.source_url, verifiedAt: r.verified_at }))
}

async function latestAsOf(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.from('on_terms').select('as_of').order('as_of', { ascending: false }).limit(1)
  if (error) throw new Error(`on_terms read failed: ${error.message}`)
  return data?.[0]?.as_of ?? null
}

export async function ingestOnTerms(
  supabase: SupabaseClient,
  opts: { fetchHtml?: () => Promise<string> } = {}
): Promise<IngestSummary> {
  const html = await (opts.fetchHtml ?? fetchBymaHtml)()
  const res = parseBymaPayload(extractPayload(html))

  const stored = await latestAsOf(supabase)
  if (stored && res.asOf < stored) throw new Error(`BYMA payload ${res.asOf} is older than stored ${stored}`)

  const overrides = await loadOverrides(supabase)
  const warnings = res.ons.flatMap((o) =>
    resolveTerms({ isin: o.isin, law: o.law, paymentPlaza: o.paymentPlaza, issuedAmountByma: o.issuedAmountByma }, overrides).warnings
  )
  for (const w of warnings) console.warn(`[OnTerms] ignored override ${w.isin}/${w.field}: ${w.reason}`)
  for (const s of [...res.skipped, ...res.sovSkipped]) console.warn(`[OnTerms] skipped ${s.tk}: ${s.reason}`)
  if (res.sovMissing) console.warn('[OnTerms] sovereign curve missing or too small: keeping last-good')

  const checks = computeYieldChecks(res.ons, overrides, res.settle, res.asOf)
  const { error } = await supabase.rpc('replace_on_terms', toRpcArgs(res, checks))
  if (error) throw new Error(`replace_on_terms failed: ${error.message}`)

  return {
    asOf: res.asOf,
    ons: res.ons.length,
    skipped: res.skipped.length,
    sov: res.sovMissing ? 0 : res.sov.length,
    checks: checks.length,
    flagged: checks.filter((c) => c.flagged).length,
    warnings: warnings.length,
  }
}
