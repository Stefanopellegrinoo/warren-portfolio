// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CONCEPTS, fetchSecStatements, fetchSecTickers, normalizeCompanyFacts, secSeries, secUserAgent } from '../sec'
import { FundamentalsSourceError } from '../types'
import { periodLabel } from '../explain'

// Public company names only; every number is invented.
const UA = 'WarrenPortfolio research contact@example.com'

interface Fact { start?: string; end: string; val: number; form: string; filed: string }
const fact = (start: string | null, end: string, val: number, form = '10-Q', filed = `${end.slice(0, 4)}-${end.slice(5, 7) === '12' ? '12-31' : end.slice(5)}`): Fact =>
  ({ ...(start ? { start } : {}), end, val, form, filed })

const ENDS = ['03-31', '06-30', '09-30', '12-31']
const STARTS = ['01-01', '04-01', '07-01', '10-01']
const total = (q: number[], i: number) => q.slice(0, i + 1).reduce((s, x) => s + x, 0)
/** An income line as a 10-Q/10-K filer tags it: each 10-Q gives its quarter and the year to date; the 10-K, the year only. */
const income = (year: number, q: number[]): Fact[] =>
  q.flatMap((v, i) => [
    ...(i < 3 ? [fact(`${year}-${STARTS[i]}`, `${year}-${ENDS[i]}`, v)] : []),
    ...(i > 0 ? [fact(`${year}-01-01`, `${year}-${ENDS[i]}`, total(q, i), i === 3 ? '10-K' : '10-Q')] : []),
  ])
/** A cash flow line: the year to date only. */
const cash = (year: number, q: number[]): Fact[] =>
  q.map((_, i) => fact(`${year}-01-01`, `${year}-${ENDS[i]}`, total(q, i), i === 3 ? '10-K' : '10-Q'))
/** A balance line at each quarter end. */
const stock = (year: number, q: number[]): Fact[] => q.map((v, i) => fact(null, `${year}-${ENDS[i]}`, v, i === 3 ? '10-K' : '10-Q'))

function companyFacts(concepts: Record<string, Fact[]>, taxonomy = 'us-gaap') {
  return {
    cik: 1099590,
    entityName: 'Example Corp',
    facts: { dei: {}, [taxonomy]: Object.fromEntries(Object.entries(concepts).map(([name, facts]) => [name, { label: name, units: { USD: facts } }])) },
  }
}
/** Revenue for 2025 and half of 2026: what makes the company's latest quarter 2026-06-30. */
const revenue = () => [...income(2025, [10, 20, 30, 45]), ...income(2026, [12, 22])]

describe('normalizeCompanyFacts: quarters and years', () => {
  it('a quarter reported only as a year-to-date total is the difference of two totals: Q4 is the year minus Q1–Q3', () => {
    const sec = secSeries(normalizeCompanyFacts(companyFacts({
      Revenues: revenue(),
      NetCashProvidedByUsedInOperatingActivities: [...cash(2025, [5, 6, 7, 8]), ...cash(2026, [9, 4])],
    }))!)

    expect(sec.quarterly.revenue).toEqual([
      { end: '2025-03-31', value: 10 }, { end: '2025-06-30', value: 20 }, { end: '2025-09-30', value: 30 }, { end: '2025-12-31', value: 45 },
      { end: '2026-03-31', value: 12 }, { end: '2026-06-30', value: 22 },
    ])
    expect(sec.annual.revenue).toEqual([{ end: '2025-12-31', value: 105 }])
    // The four quarters add up to the year.
    expect(sec.quarterly.revenue!.slice(0, 4).reduce((s, p) => s + p.value, 0)).toBe(105)
    // Cash flows come year to date in every 10-Q: Q2 = 6 months − 3, Q3 = 9 − 6, Q4 = the year − 9.
    expect(sec.quarterly.operatingCashFlow!.map((p) => p.value)).toEqual([5, 6, 7, 8, 9, 4])
    expect(sec.annual.operatingCashFlow).toEqual([{ end: '2025-12-31', value: 26 }])
  })

  it('a quarter the 10-Q states directly wins over a difference of totals; a restatement (filed later) wins over the original', () => {
    const facts = [
      ...revenue(),
      // The 6-month total disagrees with Q1 + Q2: the reported quarter stands.
      fact('2026-01-01', '2026-06-30', 40),
      // A later filing restates Q1 2025.
      fact('2025-01-01', '2025-03-31', 11, '10-Q', '2026-05-01'),
    ]
    const sec = secSeries(normalizeCompanyFacts(companyFacts({ Revenues: facts }))!)

    expect(sec.quarterly.revenue!.find((p) => p.end === '2026-06-30')!.value).toBe(22)
    expect(sec.quarterly.revenue![0]).toEqual({ end: '2025-03-31', value: 11 })
  })

  it('reads a 52/53-week fiscal year (quarters of 13 or 14 weeks)', () => {
    const facts = [
      fact('2025-01-27', '2025-04-27', 100),
      fact('2025-04-28', '2025-07-27', 110), fact('2025-01-27', '2025-07-27', 210),
      fact('2025-07-28', '2025-10-26', 120), fact('2025-01-27', '2025-10-26', 330),
      fact('2025-01-27', '2026-01-25', 470, '10-K'),
    ]
    const sec = secSeries(normalizeCompanyFacts(companyFacts({ Revenues: facts }))!)

    // Its period ends read as month ends (L38 D1): 2026-01-25 is January's.
    expect(sec.quarterly.revenue!.at(-1)).toEqual({ end: '2026-01-31', value: 140 })
    expect(sec.annual.revenue).toEqual([{ end: '2026-01-31', value: 470 }])
  })

  it("snaps each period end to the nearest month end, as TradingView: NVDA's 2021-05-02 is 2021-04-30, feb–abr 2021 (L38 D1)", () => {
    // NVDA's fiscal 2022: Feb 1, 2021 – Jan 30, 2022. Day 7 or earlier is the previous month's end; day 8 on, its own.
    const sec = secSeries(normalizeCompanyFacts(companyFacts({
      Revenues: [
        fact('2021-02-01', '2021-05-02', 100),
        fact('2021-05-03', '2021-08-01', 110), fact('2021-02-01', '2021-08-01', 210),
        fact('2021-08-02', '2021-10-31', 120), fact('2021-02-01', '2021-10-31', 330),
        fact('2021-02-01', '2022-01-30', 470, '10-K'),
        // A mid-month end (day 8 on) is its own month's: 2022-05-15 → 2022-05-31. Its length is read on the filed
        // dates: 90 days, a quarter (106 days to the month end would not be).
        fact('2022-02-14', '2022-05-15', 130),
      ],
      Assets: [fact(null, '2021-05-02', 1000), fact(null, '2021-08-01', 1100), fact(null, '2021-10-31', 1200), fact(null, '2022-01-30', 1300, '10-K'), fact(null, '2022-05-15', 1400)],
    }))!)

    expect(sec.quarterly.revenue).toEqual([
      { end: '2021-04-30', value: 100 }, { end: '2021-07-31', value: 110 }, { end: '2021-10-31', value: 120 },
      // Q4 is still the year minus the nine months.
      { end: '2022-01-31', value: 140 }, { end: '2022-05-31', value: 130 },
    ])
    expect(sec.annual.revenue).toEqual([{ end: '2022-01-31', value: 470 }])
    // Balances at the same ends, so one quarter is one column.
    expect(sec.quarterly.totalAssets!.map((p) => p.end)).toEqual(['2021-04-30', '2021-07-31', '2021-10-31', '2022-01-31', '2022-05-31'])
    expect(sec.annual.totalAssets).toEqual([{ end: '2022-01-31', value: 1300 }])
    expect(periodLabel(sec.quarterly.revenue![0].end, 'quarterly')).toBe('feb–abr 2021')
  })

  it('takes balance lines directly at each period end; the year view reads them at fiscal year ends, and an odd date is no period', () => {
    const sec = secSeries(normalizeCompanyFacts(companyFacts({
      Revenues: revenue(),
      Assets: [...stock(2025, [100, 110, 120, 130]), ...stock(2026, [140, 150]), fact(null, '2025-08-15', 999)],
    }))!)

    expect(sec.quarterly.totalAssets!.map((p) => [p.end, p.value])).toEqual([
      ['2025-03-31', 100], ['2025-06-30', 110], ['2025-09-30', 120], ['2025-12-31', 130], ['2026-03-31', 140], ['2026-06-30', 150],
    ])
    expect(sec.annual.totalAssets).toEqual([{ end: '2025-12-31', value: 130 }])
  })

  it('outflows read negative, as in Yahoo; working capital is current assets − current liabilities; FCF is left to the statements', () => {
    const sec = secSeries(normalizeCompanyFacts(companyFacts({
      Revenues: revenue(),
      PaymentsToAcquirePropertyPlantAndEquipment: [...cash(2025, [1, 2, 3, 4]), ...cash(2026, [5, 6])],
      AssetsCurrent: [...stock(2025, [50, 50, 50, 50]), ...stock(2026, [60, 70])],
      LiabilitiesCurrent: [...stock(2025, [20, 20, 20, 20]), ...stock(2026, [25, 30])],
    }))!)

    expect(sec.quarterly.capitalExpenditure!.map((p) => p.value)).toEqual([-1, -2, -3, -4, -5, -6])
    expect(sec.quarterly.workingCapital!.slice(-2)).toEqual([{ end: '2026-03-31', value: 35 }, { end: '2026-06-30', value: 40 }])
    expect(sec.annual.workingCapital).toEqual([{ end: '2025-12-31', value: 30 }])
    expect(sec.quarterly.freeCashFlow).toBeUndefined()
  })

  it('counts only 10-K and 10-Q facts: a registration statement\'s pro forma figure is not the company\'s', () => {
    const sec = secSeries(normalizeCompanyFacts(companyFacts({ Revenues: [...revenue(), fact('2025-04-01', '2025-06-30', 999, 'S-4', '2026-09-01')] }))!)

    expect(sec.quarterly.revenue!.find((p) => p.end === '2025-06-30')!.value).toBe(20)
  })
})

describe('normalizeCompanyFacts: one concept per line', () => {
  it('a line never mixes two concepts: a company that changed concepts shows the current one only', () => {
    // Revenues for three years, then the contract revenue concept: the row is the current concept's alone, though shorter.
    const sec = secSeries(normalizeCompanyFacts(companyFacts({
      Revenues: [2022, 2023, 2024].flatMap((y) => income(y, [7, 8, 9, 10])),
      RevenueFromContractWithCustomerExcludingAssessedTax: revenue(),
    }))!)

    expect(sec.quarterly.revenue!.map((p) => p.end)).toEqual(['2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30'])
    expect(sec.annual.revenue).toEqual([{ end: '2025-12-31', value: 105 }])
  })

  it("between two current concepts, the list's first (the line's definition), alone, even with fewer periods", () => {
    // Contract revenue leaves out financial income (MELI's fintech), so it is not total revenue: never pieced together.
    const sec = secSeries(normalizeCompanyFacts(companyFacts({
      Revenues: revenue(),
      RevenueFromContractWithCustomerExcludingAssessedTax: [2023, 2024, 2025].flatMap((y) => income(y, [9, 18, 27, 40])).concat(income(2026, [11, 20])),
    }))!)

    expect(sec.quarterly.revenue!.map((p) => p.value)).toEqual([10, 20, 30, 45, 12, 22])
    expect(sec.annual.revenue).toEqual([{ end: '2025-12-31', value: 105 }])
  })

  it('a concept the company stopped using is no row: that line keeps its other source', () => {
    const sec = secSeries(normalizeCompanyFacts(companyFacts({ Revenues: revenue(), InterestExpense: income(2010, [1, 1, 1, 1]) }))!)

    expect(sec.quarterly.interestExpense).toBeUndefined()
    expect(sec.annual.interestExpense).toBeUndefined()
  })

  it('a balance line given only at year ends is a year row, not a quarter row', () => {
    const sec = secSeries(normalizeCompanyFacts(companyFacts({ Revenues: revenue(), Goodwill: [fact(null, '2024-12-31', 5, '10-K'), fact(null, '2025-12-31', 6, '10-K')] }))!)

    expect(sec.quarterly.goodwill).toBeUndefined()
    expect(sec.annual.goodwill).toEqual([{ end: '2025-12-31', value: 6 }])
  })

  it('maps amounts only: EPS and share counts break at every split in SEC data, so they keep their sources', () => {
    expect(Object.keys(CONCEPTS)).not.toContain('dilutedEps')
    expect(Object.keys(CONCEPTS)).not.toContain('dilutedAverageShares')
    expect(Object.keys(CONCEPTS)).not.toContain('ordinarySharesNumber')
    for (const c of Object.values(CONCEPTS)) expect(c!.length).toBeGreaterThan(0)
  })
})

describe('normalizeCompanyFacts: who files 10-Q', () => {
  it('a 20-F filer (annual reports, 6-K in between) is null: its rows stay Yahoo and TradingView', () => {
    const twentyF = companyFacts({ Revenues: [fact('2025-01-01', '2025-12-31', 100, '20-F'), fact('2026-01-01', '2026-06-30', 60, '6-K')] })
    expect(normalizeCompanyFacts(twentyF)).toBeNull()
  })

  it('an IFRS filer has no us-gaap facts: null', () => {
    expect(normalizeCompanyFacts(companyFacts({ Revenue: revenue() }, 'ifrs-full'))).toBeNull()
  })

  it('a company that moved from 10-Q to 20-F is null', () => {
    const moved = companyFacts({ Revenues: [...income(2018, [1, 2, 3, 4]), fact('2025-01-01', '2025-12-31', 100, '20-F', '2026-04-01')] })
    expect(normalizeCompanyFacts(moved)).toBeNull()
  })

  it('an unreadable answer is null, never a throw', () => {
    for (const bad of [null, 'x', { facts: 1 }, { facts: { 'us-gaap': { Revenues: { units: { USD: [{ end: 5 }] } } } } }]) {
      expect(normalizeCompanyFacts(bad)).toBeNull()
    }
  })
})

describe('normalizeCompanyFacts: size', () => {
  it('17 years of every mapped line, the size of a large company, caches in under 40 KB', () => {
    let n = 0
    const big = () => 12_345_678_000 + n++ * 1_000
    const concepts = Object.fromEntries(
      Object.values(CONCEPTS).map((names) => {
        const name = names![0]
        const flow = !/^(Assets|AssetsCurrent|Cash|Accounts|Inventory|PropertyPlant|Goodwill|Liabilities|LongTermDebt|StockholdersEquity)/.test(name)
        const facts = Array.from({ length: 18 }, (_, i) => 2009 + i).flatMap((y) => {
          const q = y === 2026 ? [big(), big()] : [big(), big(), big(), big()]
          return flow ? (/^(NetCash|Payments)/.test(name) ? cash(y, q) : income(y, q)) : stock(y, q)
        })
        return [name, facts]
      }),
    )

    const sec = normalizeCompanyFacts(companyFacts(concepts))!

    expect(Object.keys(secSeries(sec).quarterly).length).toBeGreaterThanOrEqual(25)
    expect(secSeries(sec).quarterly.revenue).toHaveLength(17 * 4 + 2)
    expect(JSON.stringify(sec).length).toBeLessThan(40_000)
  })
})

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('fetchSecTickers (ticker → CIK)', () => {
  it("asks with the app's User-Agent and a timeout, and maps each ticker to its CIK (a ticker's first row is its main listing)", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => json({
      0: { cik_str: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' },
      1: { cik_str: 1099590, ticker: 'MELI', title: 'MERCADOLIBRE INC' },
      2: { cik_str: 1067983, ticker: 'BRK-B', title: 'BERKSHIRE HATHAWAY INC' },
      3: { cik_str: 9999999, ticker: 'MELI', title: 'Another row' },
      4: { cik_str: 'x', ticker: 'BAD' },
    }))

    const map = await fetchSecTickers(UA, fetchImpl as unknown as typeof fetch)

    expect(map).toEqual({ NVDA: 1045810, MELI: 1099590, 'BRK-B': 1067983 })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://www.sec.gov/files/company_tickers.json')
    const init = fetchImpl.mock.calls[0][1]!
    expect(new Headers(init.headers).get('User-Agent')).toBe(UA)
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('an HTTP error is unavailable; an answer with no tickers is bad_shape', async () => {
    await expect(fetchSecTickers(UA, (async () => json({}, 403)) as unknown as typeof fetch)).rejects.toMatchObject({ source: 'sec', code: 'unavailable' })
    await expect(fetchSecTickers(UA, (async () => json({ a: 1 })) as unknown as typeof fetch)).rejects.toMatchObject({ source: 'sec', code: 'bad_shape' })
    await expect(fetchSecTickers(UA, (async () => { throw new Error('timeout') }) as unknown as typeof fetch)).rejects.toBeInstanceOf(FundamentalsSourceError)
  })
})

describe('fetchSecStatements', () => {
  it("asks companyfacts by the 10-digit CIK with the app's User-Agent and returns the compact copy", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => json(companyFacts({ Revenues: revenue() })))

    const sec = await fetchSecStatements(1099590, UA, fetchImpl as unknown as typeof fetch)

    expect(fetchImpl.mock.calls[0][0]).toBe('https://data.sec.gov/api/xbrl/companyfacts/CIK0001099590.json')
    expect(new Headers(fetchImpl.mock.calls[0][1]!.headers).get('User-Agent')).toBe(UA)
    expect(secSeries(sec!).annual.revenue).toEqual([{ end: '2025-12-31', value: 105 }])
  })

  it('a CIK without XBRL facts (404) is null; any other HTTP error is unavailable', async () => {
    expect(await fetchSecStatements(1, UA, (async () => json({}, 404)) as unknown as typeof fetch)).toBeNull()
    await expect(fetchSecStatements(1, UA, (async () => json({}, 503)) as unknown as typeof fetch)).rejects.toMatchObject({ code: 'unavailable' })
  })
})

describe('secUserAgent', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('is the configured SEC_USER_AGENT; unset or blank, the SEC is off', () => {
    vi.stubEnv('SEC_USER_AGENT', '  WarrenPortfolio research contact@example.com ')
    expect(secUserAgent()).toBe(UA)
    vi.stubEnv('SEC_USER_AGENT', '  ')
    expect(secUserAgent()).toBeNull()
    vi.stubEnv('SEC_USER_AGENT', undefined)
    expect(secUserAgent()).toBeNull()
  })
})
