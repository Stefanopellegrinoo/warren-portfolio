/**
 * SEC source for Balances completos (odd/tasks/asset-page.md T12, S8): the official XBRL statements of US 10-Q
 * filers since about 2009, from data.sec.gov companyfacts. Server only.
 *
 * No caching here: the service caches the compact copy these return, never the ~4 MB raw answer. The SEC refuses
 * requests without a User-Agent naming the app and a contact, so the source is off until SEC_USER_AGENT is set.
 */
import { LINES } from './statements'
import { FundamentalsSourceError, type Series } from './types'
import type { YahooLine } from './yahoo'

const TIMEOUT_MS = 20_000
const DAY_MS = 86_400_000

/** "App Name contact@example.com" from the environment; null (unset or blank) turns the SEC off: no request at all. */
export const secUserAgent = (): string | null => process.env.SEC_USER_AGENT?.trim() || null

/**
 * Page line → its us-gaap concepts, in order of preference. Per company one concept per line, never pieced
 * together across periods (S5): the current one with the most periods (see `pick`). Amounts in USD only: SEC's EPS
 * and share counts keep pre-split values next to restated ones (NVDA's diluted shares jump ×4 in 2021 and ×10 in
 * 2024), so those rows keep their sources. No EBIT, EBITDA or total debt: US GAAP has no such line.
 */
export const CONCEPTS: Partial<Record<YahooLine, readonly string[]>> = {
  revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet', 'SalesRevenueServicesNet'],
  costOfRevenue: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfServices'],
  grossProfit: ['GrossProfit'],
  researchAndDevelopment: ['ResearchAndDevelopmentExpense', 'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost'],
  sellingGeneralAndAdministration: ['SellingGeneralAndAdministrativeExpense'],
  operatingIncome: ['OperatingIncomeLoss'],
  interestExpense: ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt'],
  pretaxIncome: [
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
  ],
  taxProvision: ['IncomeTaxExpenseBenefit'],
  netIncome: ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ProfitLoss'],
  totalAssets: ['Assets'],
  currentAssets: ['AssetsCurrent'],
  cashAndCashEquivalents: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'Cash'],
  cashAndShortTermInvestments: ['CashCashEquivalentsAndShortTermInvestments'],
  accountsReceivable: ['AccountsReceivableNetCurrent', 'ReceivablesNetCurrent'],
  inventory: ['InventoryNet'],
  netPPE: ['PropertyPlantAndEquipmentNet'],
  goodwill: ['Goodwill'],
  totalLiabilities: ['Liabilities'],
  currentLiabilities: ['LiabilitiesCurrent'],
  accountsPayable: ['AccountsPayableCurrent'],
  // Excluding current maturities, as Yahoo's line; LongTermDebt includes them.
  longTermDebt: ['LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations'],
  stockholdersEquity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  capitalExpenditure: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  investingCashFlow: ['NetCashProvidedByUsedInInvestingActivities', 'NetCashProvidedByUsedInInvestingActivitiesContinuingOperations'],
  financingCashFlow: ['NetCashProvidedByUsedInFinancingActivities', 'NetCashProvidedByUsedInFinancingActivitiesContinuingOperations'],
  repurchaseOfCapitalStock: ['PaymentsForRepurchaseOfCommonStock'],
  cashDividendsPaid: ['PaymentsOfDividendsCommonStock', 'PaymentsOfDividends'],
}
/** SEC tags payments as positive amounts; the page shows money going out as negative, as Yahoo does. */
const OUTFLOWS = new Set<YahooLine>(['capitalExpenditure', 'repurchaseOfCapitalStock', 'cashDividendsPaid'])
const INSTANT = new Set(LINES.filter((d) => d.statement === 'balance').map((d) => d.id))

/** A mode's lines on one shared list of period ends, oldest first; null where a line has no value. */
export interface SecTable {
  ends: string[]
  lines: Partial<Record<YahooLine, (number | null)[]>>
}
/** The compact copy the service caches: 17 years of ~30 lines in ~30 KB (as {end, value} points it would be ~100 KB). */
export interface SecStatements {
  quarterly: SecTable
  annual: SecTable
}

interface Fact {
  start?: string
  end: string
  val: number
  form: string
  filed: string
}
type Periods = Map<string, number>
interface Built {
  quarterly: Periods
  annual: Periods
}

const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY_MS
// 13 or 14 weeks; 52 or 53 weeks.
const isQuarter = (d: number) => d >= 80 && d <= 100
const isYear = (d: number) => d >= 350 && d <= 380
const DATE = /^\d{4}-\d{2}-\d{2}$/
// 10-K, 10-Q, their amendments and transition reports: never a registration statement's pro forma figures.
const PERIODIC = /^10-[KQ]/
const record = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

function isFact(f: unknown): f is Fact {
  if (!record(f)) return false
  const { start, end, val, form, filed } = f
  return (start === undefined || (typeof start === 'string' && DATE.test(start))) && typeof end === 'string' && DATE.test(end) &&
    typeof val === 'number' && Number.isFinite(val) && typeof form === 'string' && typeof filed === 'string'
}

/** A concept's USD facts from 10-K and 10-Q, one per period: the latest filed, so a restatement wins. */
function factsOf(gaap: Record<string, unknown>, concept: string): Fact[] {
  const c = gaap[concept]
  const raw = record(c) && record(c.units) ? c.units.USD : undefined
  const byPeriod = new Map<string, Fact>()
  for (const f of Array.isArray(raw) ? raw : []) {
    if (!isFact(f) || !PERIODIC.test(f.form)) continue
    const key = `${f.start ?? ''}|${f.end}`
    if ((byPeriod.get(key)?.filed ?? '') <= f.filed) byPeriod.set(key, f)
  }
  return [...byPeriod.values()]
}

/**
 * A flow's quarters and years. A 10-Q states its quarter and the year to date (cash flows only the year to date);
 * the 10-K only the year. A quarter not stated is the difference of two totals from the same start a quarter
 * apart: Q2 = 6 months − Q1, Q3 = 9 − 6, Q4 = the year − 9 months (Q1–Q3).
 */
function flows(facts: Fact[]): Built {
  const quarterly: Periods = new Map()
  const annual: Periods = new Map()
  const runs = new Map<string, Fact[]>()
  for (const f of facts) {
    if (!f.start) continue
    const d = days(f.start, f.end)
    if (isQuarter(d)) quarterly.set(f.end, f.val)
    if (isYear(d)) annual.set(f.end, f.val)
    runs.set(f.start, [...(runs.get(f.start) ?? []), f])
  }
  for (const run of runs.values()) {
    run.sort((a, b) => (a.end < b.end ? -1 : 1))
    run.forEach((f, i) => {
      const prev = run[i - 1]
      if (prev && !quarterly.has(f.end) && isQuarter(days(prev.end, f.end))) quarterly.set(f.end, f.val - prev.val)
    })
  }
  return { quarterly, annual }
}

/** A balance line at the company's period ends: quarter ends, and fiscal year ends for the year view. */
function stocks(facts: Fact[], quarterEnds: Set<string>, yearEnds: Set<string>): Built {
  const at = facts.filter((f) => !f.start)
  return {
    quarterly: new Map(at.filter((f) => quarterEnds.has(f.end)).map((f) => [f.end, f.val])),
    annual: new Map(at.filter((f) => yearEnds.has(f.end)).map((f) => [f.end, f.val])),
  }
}

const lastEnd = (p: Periods) => [...p.keys()].sort().at(-1) ?? ''

/**
 * The line's concept for this company: the first in the list among those that reach its newest period. One
 * concept, never two pieced together. Coverage decides only whether a concept is current: the list's order is the
 * line's definition. MELI tags both Revenues (28.893 M in 2025, what TradingView shows) and contract revenue
 * (20.335 M, without its fintech income), and the second has more periods.
 */
function pick(candidates: Built[]): Built | undefined {
  const latest = (b: Built) => [lastEnd(b.quarterly), lastEnd(b.annual)].sort().at(-1)!
  const newest = candidates.map(latest).sort().at(-1)
  return newest ? candidates.find((b) => latest(b) === newest) : undefined
}

/** One mode as a compact table: only the lines that reach the company's latest period (a dropped concept is no row). */
function table(lines: [YahooLine, Periods][]): SecTable {
  const latest = lines.map(([, p]) => lastEnd(p)).sort().at(-1) ?? ''
  const kept = lines.filter(([, p]) => p.size > 0 && lastEnd(p) === latest)
  const ends = [...new Set(kept.flatMap(([, p]) => [...p.keys()]))].sort()
  return { ends, lines: Object.fromEntries(kept.map(([line, p]) => [line, ends.map((e) => p.get(e) ?? null)])) }
}

/** A 10-Q filer: it files quarterly reports, and no 20-F or 40-F (annual only) after its last one. */
function filesTenQ(gaap: Record<string, unknown>): boolean {
  let tenQ = ''
  let foreign = ''
  for (const c of Object.values(gaap)) {
    for (const facts of record(c) && record(c.units) ? Object.values(c.units) : []) {
      for (const f of Array.isArray(facts) ? facts : []) {
        if (!isFact(f)) continue
        if (f.form.startsWith('10-Q') && f.filed > tenQ) tenQ = f.filed
        else if (/^[24]0-F/.test(f.form) && f.filed > foreign) foreign = f.filed
      }
    }
  }
  return tenQ > foreign
}

/** companyfacts → the compact copy of the page's lines; null for a 20-F/IFRS filer or an answer without them. */
export function normalizeCompanyFacts(data: unknown): SecStatements | null {
  const gaap = record(data) && record(data.facts) ? data.facts['us-gaap'] : undefined
  if (!record(gaap) || !filesTenQ(gaap)) return null
  const entries = Object.entries(CONCEPTS) as [YahooLine, readonly string[]][]
  const signed = (line: YahooLine, b: Built): Built => {
    if (!OUTFLOWS.has(line)) return b
    const neg = (p: Periods) => new Map([...p].map(([e, v]) => [e, -v]))
    return { quarterly: neg(b.quarterly), annual: neg(b.annual) }
  }
  const built = new Map<YahooLine, Built>()
  for (const [line, names] of entries) {
    if (INSTANT.has(line)) continue
    const b = pick(names.map((n) => flows(factsOf(gaap, n))))
    if (b) built.set(line, signed(line, b))
  }
  // Balance lines count only at the flows' period ends: an odd date in a note is no column.
  const yearEnds = new Set([...built.values()].flatMap((b) => [...b.annual.keys()]))
  const quarterEnds = new Set([...built.values()].flatMap((b) => [...b.quarterly.keys()]).concat([...yearEnds]))
  for (const [line, names] of entries) {
    if (!INSTANT.has(line)) continue
    const b = pick(names.map((n) => stocks(factsOf(gaap, n), quarterEnds, yearEnds)))
    if (b) built.set(line, b)
  }
  const ca = built.get('currentAssets')
  const cl = built.get('currentLiabilities')
  if (ca && cl) {
    const minus = (a: Periods, b: Periods) => new Map([...a].flatMap(([e, v]) => (b.has(e) ? [[e, v - b.get(e)!] as const] : [])))
    built.set('workingCapital', { quarterly: minus(ca.quarterly, cl.quarterly), annual: minus(ca.annual, cl.annual) })
  }
  const all = [...built]
  const out = { quarterly: table(all.map(([l, b]) => [l, b.quarterly])), annual: table(all.map(([l, b]) => [l, b.annual])) }
  return out.quarterly.ends.length || out.annual.ends.length ? out : null
}

/** The compact copy as the statements' series, oldest first. */
export function secSeries(s: SecStatements): Record<'quarterly' | 'annual', Partial<Record<YahooLine, Series>>> {
  const expand = (t: SecTable) =>
    Object.fromEntries(
      Object.entries(t.lines).map(([line, values]) => [line, t.ends.flatMap((end, i) => (values![i] === null ? [] : [{ end, value: values![i]! }]))]),
    )
  return { quarterly: expand(s.quarterly), annual: expand(s.annual) }
}

const fail = (code: FundamentalsSourceError['code'], message: string) => new FundamentalsSourceError('sec', code, message)

async function getJson(url: string, userAgent: string, fetchImpl: typeof fetch): Promise<unknown> {
  let res: Response
  try {
    res = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    throw fail('unavailable', err instanceof Error ? err.message : String(err))
  }
  if (res.status === 404) throw fail('not_found', url)
  if (!res.ok) throw fail('unavailable', `HTTP ${res.status}`)
  return res.json().catch(() => {
    throw fail('bad_shape', `unreadable ${url}`)
  })
}

/** Every SEC registrant's ticker → CIK (~155 KB as JSON). A ticker's first row is its main listing. */
export async function fetchSecTickers(userAgent: string, fetchImpl: typeof fetch = fetch): Promise<Record<string, number>> {
  const data = await getJson('https://www.sec.gov/files/company_tickers.json', userAgent, fetchImpl)
  const out: Record<string, number> = {}
  for (const row of record(data) ? Object.values(data) : []) {
    if (record(row) && typeof row.ticker === 'string' && Number.isInteger(row.cik_str) && !(row.ticker in out)) out[row.ticker] = row.cik_str as number
  }
  if (Object.keys(out).length === 0) throw fail('bad_shape', 'no tickers in company_tickers.json')
  return out
}

/** A company's statements as the compact copy; null for a 20-F filer or a CIK without XBRL facts. */
export async function fetchSecStatements(cik: number, userAgent: string, fetchImpl: typeof fetch = fetch): Promise<SecStatements | null> {
  try {
    return normalizeCompanyFacts(await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`, userAgent, fetchImpl))
  } catch (err) {
    if (err instanceof FundamentalsSourceError && err.code === 'not_found') return null
    throw err
  }
}
