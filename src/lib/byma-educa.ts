// Pure adapter for the BYMA Educa daily fixed-income report (no network, no DB).
// The page embeds its data as <script id="payload" type="application/json">{ on, tp, ... }.
// Public bond terms and prices only. See scripts/build-byma-oracle-fixture.ts.
import { z } from 'zod'
import { addDays, toMs } from './ar-calendar'

export class BymaParseError extends Error {}

export const MIN_VALID_ROWS = 200
export const MAX_INVALID_RATIO = 0.1
export const MIN_SOV_ROWS = 5
// Keys whose absence (undefined, not null) means BYMA changed the payload shape.
export const CRITICAL_KEYS = ['cup', 'vr', 'ren', 'amo', 'fv', 'isin', 'px'] as const

export const isRealDate = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const t = Date.parse(`${s}T00:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s
}
const isoDate = z.string().refine(isRealDate, 'not a real ISO date')
// Bounded so a value never overflows the NUMERIC column it lands in (a bad row is
// skipped instead of aborting the whole RPC). Limits sit under each column's range.
const bounded = (max: number) => z.number().finite().gt(-max).lt(max)
const num = bounded(1e6) // ytm, ai, dm, residual, adtv checks (NUMERIC(10,4))
const flowNum = bounded(1e8) // ren, amo (NUMERIC(14,6))
const flowPair = z.tuple([isoDate, flowNum])

const RowSchema = z.object({
  tk: z.string().min(1),
  isin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/),
  em: z.string().nullish(),
  de: z.string().nullish(),
  ley: z.enum(['ARG', 'NY']),
  me: z.string().min(1),
  mp: z.enum(['MEP', 'CCL', 'ARS']).nullish(),
  est: z.string().nullish(),
  fc: z.string().nullish(),
  fe: isoDate,
  fv: isoDate,
  cup: bounded(1e4).nullish(), // fraction (0.0725 = 7.25%); null for zero-coupon
  vr: num.nullish(),
  mto: bounded(1e17).nullish(),
  px: bounded(1e9).nullish(),
  ytm: num.nullish(),
  ai: num.nullish(),
  dm: num.nullish(),
  ren: z.array(flowPair),
  amo: z.array(flowPair),
  adtvp: z.array(bounded(1e17).nullable()).nullish(),
  adtve: z.array(z.string().nullable()).nullish(),
})

const SovSchema = z.object({
  tk: z.string().min(1),
  isin: z.string().nullish(),
  ley: z.enum(['ARG', 'NY']),
  px: bounded(1e9).nullish(),
  ytm: num,
  dm: num,
})

export interface RawFlowRow {
  date: string
  ren: number
  amo: number
}

export interface OnRow {
  isin: string
  tickerO: string
  tickerD: string | null
  tickerC: string | null
  issuer: string | null
  description: string | null
  law: 'ARG' | 'NY'
  currency: string
  paymentPlaza: 'MEP' | 'CCL' | 'ARS' | null
  est: string | null
  frequency: string | null
  issueDate: string
  maturityDate: string
  couponRate: number | null
  residualPct: number
  accrualStart: string
  issuedAmountByma: number | null
  adtvO: number | null
  adtvD: number | null
  adtvC: number | null
  // BYMA's own numbers, kept for the daily method/terms checks.
  bymaPx: number | null
  bymaYtm: number | null
  bymaAi: number | null
  bymaDm: number | null
  flows: RawFlowRow[]
}

export interface SovRow {
  ticker: string
  isin: string | null
  law: 'ARG' | 'NY'
  px: number | null
  ytm: number
  dm: number
}

export interface BymaResult {
  asOf: string
  settle: string
  ons: OnRow[]
  skipped: { tk: string; reason: string }[]
  sov: SovRow[]
  sovSkipped: { tk: string; reason: string }[]
  sovMissing: boolean
}

export function extractPayload(html: string): unknown {
  const m = html.match(/<script\b[^>]*\bid="payload"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) throw new BymaParseError('BYMA payload script not found')
  try {
    return JSON.parse(m[1])
  } catch (e) {
    throw new BymaParseError(`BYMA payload is not valid JSON: ${(e as Error).message}`)
  }
}

const PERIOD_MONTHS: Record<string, number> = { Anual: 12, Semestral: 6, Trimestral: 3 }

function addMonths(iso: string, months: number): string {
  const d = new Date(toMs(iso))
  const day = d.getUTCDate()
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1)
  const last = new Date(Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(t + (Math.min(day, last) - 1) * 86_400_000).toISOString().slice(0, 10)
}

// BYMA `ren` lists only FUTURE flows, so the accrual period that contains the first
// one starts one coupon period earlier (clamped to the issue date). A start after
// settle means a long first period: it starts at issue.
export function accrualStartOf(fc: string | null | undefined, issue: string, flowDates: string[], settle: string): string {
  const months = fc ? PERIOD_MONTHS[fc] : undefined
  if (!months || flowDates.length === 0) return issue
  const start = addMonths([...flowDates].sort()[0], -months)
  if (start > settle) return issue
  return start > issue ? start : issue
}

function line(arr: (string | number | null)[] | null | undefined, i: number): number | null {
  const v = arr?.[i]
  return typeof v === 'number' ? v : null
}

function toOn(r: z.infer<typeof RowSchema>, settle: string): OnRow {
  const t = r.adtve ?? []
  return {
    isin: r.isin,
    tickerO: t[0] ?? r.tk,
    tickerD: t[1] ?? null,
    tickerC: t[2] ?? null,
    issuer: r.em ?? null,
    description: r.de ?? null,
    law: r.ley,
    currency: r.me,
    paymentPlaza: r.mp ?? null,
    est: r.est ?? null,
    frequency: r.fc ?? null,
    issueDate: r.fe,
    maturityDate: r.fv,
    couponRate: r.cup ?? null,
    residualPct: r.vr ?? 100,
    accrualStart: accrualStartOf(r.fc, r.fe, r.ren.map((f) => f[0]), settle),
    issuedAmountByma: r.mto ?? null,
    adtvO: line(r.adtvp, 0),
    adtvD: line(r.adtvp, 1),
    adtvC: line(r.adtvp, 2),
    bymaPx: r.px ?? null,
    bymaYtm: r.ytm ?? null,
    bymaAi: r.ai ?? null,
    bymaDm: r.dm ?? null,
    // ren/amo are paired by date; the same date can hold coupon and amortization.
    flows: mergeFlows(r.ren, r.amo),
  }
}

function mergeFlows(ren: [string, number][], amo: [string, number][]): RawFlowRow[] {
  const by = new Map<string, RawFlowRow>()
  for (const [date, v] of ren) by.set(date, { date, ren: v, amo: 0 })
  for (const [date, v] of amo) by.set(date, { date, ren: by.get(date)?.ren ?? 0, amo: v })
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function parseSov(tp: unknown): { rows: SovRow[]; skipped: BymaResult['sovSkipped'] } | null {
  const rows = (tp as { rows?: unknown } | null | undefined)?.rows
  if (!Array.isArray(rows)) return null
  const out: SovRow[] = []
  const skipped: BymaResult['sovSkipped'] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (r?.seg !== 'sob' || r?.me !== 'USD') continue
    const p = SovSchema.safeParse(r)
    if (!p.success) continue
    if (seen.has(p.data.tk)) {
      skipped.push({ tk: p.data.tk, reason: 'duplicate ticker' })
      continue
    }
    seen.add(p.data.tk)
    out.push({ ticker: p.data.tk, isin: p.data.isin ?? null, law: p.data.ley, px: p.data.px ?? null, ytm: p.data.ytm, dm: p.data.dm })
  }
  return { rows: out, skipped }
}

function checkSchemaDrift(rows: unknown[]): void {
  for (const key of CRITICAL_KEYS) {
    const missing = rows.filter((r) => (r as Record<string, unknown> | null)?.[key] === undefined).length
    if (missing / rows.length > MAX_INVALID_RATIO) {
      throw new BymaParseError(`BYMA payload aborted: schema drift, key "${key}" missing in ${missing} of ${rows.length} rows`)
    }
  }
}

export function parseBymaPayload(payload: unknown): BymaResult {
  const on = (payload as { on?: { fecha?: unknown; fecha_liq?: unknown; rows?: unknown } } | null)?.on
  if (!on || !Array.isArray(on.rows) || !isoDate.safeParse(on.fecha).success) {
    throw new BymaParseError('BYMA payload has no valid `on` section')
  }
  const asOf = on.fecha as string
  const settle = isoDate.safeParse(on.fecha_liq).success ? (on.fecha_liq as string) : addDays(asOf, 1)

  if (on.rows.length === 0) throw new BymaParseError('BYMA payload aborted: no rows')
  checkSchemaDrift(on.rows)
  const ons: OnRow[] = []
  const skipped: BymaResult['skipped'] = []
  const seen = new Set<string>()
  for (const row of on.rows) {
    const p = RowSchema.safeParse(row)
    if (p.success && seen.has(p.data.isin)) skipped.push({ tk: p.data.tk, reason: `duplicate isin ${p.data.isin}` })
    else if (p.success) {
      seen.add(p.data.isin)
      ons.push(toOn(p.data, settle))
    } else skipped.push({ tk: String(row?.tk ?? '?'), reason: p.error.issues[0] ? `${p.error.issues[0].path.join('.')}: ${p.error.issues[0].message}` : 'invalid row' })
  }
  if (skipped.length / on.rows.length > MAX_INVALID_RATIO) {
    throw new BymaParseError(`BYMA payload aborted: ${skipped.length} of ${on.rows.length} rows invalid (more than 10%); e.g. ${skipped.slice(0, 3).map((x) => `${x.tk} ${x.reason}`).join(' | ')}`)
  }
  if (ons.length < MIN_VALID_ROWS) {
    throw new BymaParseError(`BYMA payload aborted: only ${ons.length} valid rows (need at least ${MIN_VALID_ROWS})`)
  }
  const parsed = parseSov((payload as { tp?: unknown }).tp)
  // Too few rows is treated like a missing section: the worker keeps the last-good curve.
  const sovOk = parsed !== null && parsed.rows.length >= MIN_SOV_ROWS
  return { asOf, settle, ons, skipped, sov: sovOk ? parsed.rows : [], sovSkipped: parsed?.skipped ?? [], sovMissing: !sovOk }
}
