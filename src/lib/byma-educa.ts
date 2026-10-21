// Pure adapter for the BYMA Educa daily fixed-income report (no network, no DB).
// The page embeds its data as <script id="payload" type="application/json">{ on, tp, ... }.
// Public bond terms and prices only. See scripts/build-byma-oracle-fixture.ts.
import { z } from 'zod'
import { addDays, toMs } from './ar-calendar'

export class BymaParseError extends Error {}

export const MIN_VALID_ROWS = 200
export const MAX_INVALID_RATIO = 0.1

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const num = z.number().finite()
const flowPair = z.tuple([isoDate, num])

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
  cup: num.nullish(), // fraction (0.0725 = 7.25%); null for zero-coupon
  vr: num.nullish(),
  mto: num.nullish(),
  px: num.nullish(),
  ytm: num.nullish(),
  ai: num.nullish(),
  dm: num.nullish(),
  ren: z.array(flowPair),
  amo: z.array(flowPair),
  adtvp: z.array(num.nullable()).nullish(),
  adtve: z.array(z.string()).nullish(),
})

const SovSchema = z.object({
  tk: z.string().min(1),
  isin: z.string().nullish(),
  ley: z.enum(['ARG', 'NY']),
  px: num.nullish(),
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
  const stem = r.tk.slice(0, -1)
  return {
    isin: r.isin,
    tickerO: t[0] ?? r.tk,
    tickerD: t[1] ?? `${stem}D`,
    tickerC: t[2] ?? `${stem}C`,
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

function parseSov(tp: unknown): SovRow[] | null {
  const rows = (tp as { rows?: unknown } | null | undefined)?.rows
  if (!Array.isArray(rows)) return null
  const out: SovRow[] = []
  for (const r of rows) {
    if (r?.seg !== 'sob' || r?.me !== 'USD') continue
    const p = SovSchema.safeParse(r)
    if (p.success) out.push({ ticker: p.data.tk, isin: p.data.isin ?? null, law: p.data.ley, px: p.data.px ?? null, ytm: p.data.ytm, dm: p.data.dm })
  }
  return out
}

export function parseBymaPayload(payload: unknown): BymaResult {
  const on = (payload as { on?: { fecha?: unknown; fecha_liq?: unknown; rows?: unknown } } | null)?.on
  if (!on || !Array.isArray(on.rows) || !isoDate.safeParse(on.fecha).success) {
    throw new BymaParseError('BYMA payload has no valid `on` section')
  }
  const asOf = on.fecha as string
  const settle = isoDate.safeParse(on.fecha_liq).success ? (on.fecha_liq as string) : addDays(asOf, 1)

  const ons: OnRow[] = []
  const skipped: BymaResult['skipped'] = []
  for (const row of on.rows) {
    const p = RowSchema.safeParse(row)
    if (p.success) ons.push(toOn(p.data, settle))
    else skipped.push({ tk: String(row?.tk ?? '?'), reason: p.error.issues[0] ? `${p.error.issues[0].path.join('.')}: ${p.error.issues[0].message}` : 'invalid row' })
  }
  if (skipped.length / on.rows.length > MAX_INVALID_RATIO) {
    throw new BymaParseError(`BYMA payload aborted: ${skipped.length} of ${on.rows.length} rows invalid (more than 10%)`)
  }
  if (ons.length < MIN_VALID_ROWS) {
    throw new BymaParseError(`BYMA payload aborted: only ${ons.length} valid rows (need at least ${MIN_VALID_ROWS})`)
  }
  const sov = parseSov((payload as { tp?: unknown }).tp)
  return { asOf, settle, ons, skipped, sov: sov ?? [], sovMissing: sov === null || sov.length === 0 }
}
