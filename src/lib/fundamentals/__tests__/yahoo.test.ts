import { describe, it, expect, vi } from 'vitest'
import { fetchYahooStatements, fetchYahooProfile } from '../yahoo'
import { FundamentalsSourceError } from '../types'

/** A fake yahoo-finance2 instance: fundamentalsTimeSeries() and quoteSummary() are scripted. */
function fakeYahoo(script: { fts?: (...args: any[]) => any; qs?: (...args: any[]) => any }) {
  const yf = {
    fundamentalsTimeSeries: vi.fn(script.fts ?? (() => { throw new Error('fundamentalsTimeSeries not scripted') })),
    quoteSummary: vi.fn(script.qs ?? (() => { throw new Error('quoteSummary not scripted') })),
  }
  return { yf, getYahoo: async () => yf }
}

// MELI's public statements as Yahoo returns them (in USD), trimmed. Rows come newest first here on
// purpose; the first row is the empty period Yahoo often sends.
const QUARTERLY = [
  {
    date: new Date('2026-06-30T00:00:00Z'), periodType: '3M',
    totalRevenue: 10169e6, operatingRevenue: 10169e6, EBITDA: 960e6, normalizedEBITDA: 1005e6,
    netIncomeCommonStockholders: 466e6, netIncome: 470e6, totalLiabilitiesNetMinorityInterest: 43522e6,
    dilutedEPS: 9.19, ordinarySharesNumber: 51e6, capitalExpenditure: -441e6,
  },
  { date: new Date('2025-03-31T00:00:00Z'), periodType: '3M' },
  {
    date: new Date('2026-03-31T00:00:00Z'), periodType: '3M',
    totalRevenue: 8845e6, EBITDA: 890e6, netIncomeCommonStockholders: 417e6, netIncome: 417e6,
    totalLiabilitiesNetMinorityInterest: null, dilutedEPS: 8.23,
  },
]
const ANNUAL = [
  { date: new Date('2024-12-31T00:00:00Z'), periodType: '12M', totalRevenue: 20777e6, freeCashFlow: 7058e6 },
  { date: new Date('2025-12-31T00:00:00Z'), periodType: '12M', totalRevenue: 28893e6, freeCashFlow: 10773e6 },
]

describe('fetchYahooStatements', () => {
  it('normalizes quarterly and annual lines oldest first, keeps only the page lines and drops missing values', async () => {
    const { yf, getYahoo } = fakeYahoo({
      fts: (_s: string, opts: { type: string }) => (opts.type === 'quarterly' ? QUARTERLY : ANNUAL),
      qs: () => ({ financialData: { financialCurrency: 'USD' } }),
    })

    const result = await fetchYahooStatements('MELI', { getYahoo })

    expect(result.quarterly).toEqual({
      revenue: [{ end: '2026-03-31', value: 8845e6 }, { end: '2026-06-30', value: 10169e6 }],
      // Reported EBITDA, never normalizedEBITDA.
      ebitda: [{ end: '2026-03-31', value: 890e6 }, { end: '2026-06-30', value: 960e6 }],
      // To common stockholders, never netIncome.
      netIncome: [{ end: '2026-03-31', value: 417e6 }, { end: '2026-06-30', value: 466e6 }],
      totalLiabilities: [{ end: '2026-06-30', value: 43522e6 }],
      dilutedEps: [{ end: '2026-03-31', value: 8.23 }, { end: '2026-06-30', value: 9.19 }],
      ordinarySharesNumber: [{ end: '2026-06-30', value: 51e6 }],
      capitalExpenditure: [{ end: '2026-06-30', value: -441e6 }],
    })
    expect(result.annual).toEqual({
      revenue: [{ end: '2024-12-31', value: 20777e6 }, { end: '2025-12-31', value: 28893e6 }],
      freeCashFlow: [{ end: '2024-12-31', value: 7058e6 }, { end: '2025-12-31', value: 10773e6 }],
    })
    const types = yf.fundamentalsTimeSeries.mock.calls.map(([symbol, opts, moduleOpts]) =>
      [symbol, opts.type, opts.module, moduleOpts.validateResult])
    expect(types).toEqual(expect.arrayContaining([['MELI', 'quarterly', 'all', false], ['MELI', 'annual', 'all', false]]))
  })

  // Balances completos (T11) shows the statements' usual lines too, each from one Yahoo field.
  it('keeps the statement lines Balances completos shows', async () => {
    const row = {
      date: new Date('2026-06-30T00:00:00Z'), periodType: '3M', researchAndDevelopment: 1, sellingGeneralAndAdministration: 2, interestExpense: 3,
      pretaxIncome: 4, taxProvision: 5, accountsReceivable: 6, netPPE: 7, goodwill: 8, accountsPayable: 9, investingCashFlow: -10,
      financingCashFlow: -11, repurchaseOfCapitalStock: -12, cashDividendsPaid: -13, operatingExpense: 14,
    }
    const { getYahoo } = fakeYahoo({ fts: () => [row], qs: () => ({ financialData: { financialCurrency: 'USD' } }) })

    const { quarterly } = await fetchYahooStatements('MELI', { getYahoo })

    const at = (value: number) => [{ end: '2026-06-30', value }]
    expect(quarterly).toEqual({
      researchAndDevelopment: at(1), sellingGeneralAndAdministration: at(2), interestExpense: at(3), pretaxIncome: at(4),
      taxProvision: at(5), accountsReceivable: at(6), netPPE: at(7), goodwill: at(8), accountsPayable: at(9), investingCashFlow: at(-10),
      financingCashFlow: at(-11), repurchaseOfCapitalStock: at(-12), cashDividendsPaid: at(-13),
    })
  })

  it("returns the statements' currency from financialData, which can differ from the price's", async () => {
    const { yf, getYahoo } = fakeYahoo({
      fts: () => ANNUAL,
      qs: () => ({ financialData: { financialCurrency: 'TWD' } }),
    })

    const result = await fetchYahooStatements('TSM', { getYahoo })

    expect(result.currency).toBe('TWD')
    expect(yf.quoteSummary).toHaveBeenCalledWith('TSM', { modules: ['financialData'] }, { validateResult: false })
  })

  it('is not_found when Yahoo answers with no statement lines (an ETF, an unknown symbol)', async () => {
    const { getYahoo } = fakeYahoo({ fts: () => [{ date: new Date('2026-06-30T00:00:00Z') }], qs: () => ({}) })

    const err = await fetchYahooStatements('SPY', { getYahoo }).catch(e => e)

    expect(err).toBeInstanceOf(FundamentalsSourceError)
    expect(err).toMatchObject({ source: 'yahoo', code: 'not_found' })
  })

  it.each([
    ['Quote not found for symbol: ZZZZ', 'not_found'],
    ['No fundamentals data found for symbol: ZZZZ', 'not_found'],
    ['fetch failed', 'unavailable'],
    ['Too Many Requests', 'unavailable'],
    ['Unexpected result: {"timeseries":null}', 'bad_shape'],
  ])('classifies a thrown "%s" as %s', async (message, code) => {
    const { getYahoo } = fakeYahoo({ fts: () => { throw new Error(message) }, qs: () => ({}) })

    const err = await fetchYahooStatements('ZZZZ', { getYahoo }).catch(e => e)

    expect(err).toBeInstanceOf(FundamentalsSourceError)
    expect(err).toMatchObject({ source: 'yahoo', code })
  })

  it('is bad_shape when the statements are not a list', async () => {
    const { getYahoo } = fakeYahoo({ fts: () => ({ rows: [] }), qs: () => ({}) })

    const err = await fetchYahooStatements('MELI', { getYahoo }).catch(e => e)

    expect(err).toMatchObject({ source: 'yahoo', code: 'bad_shape' })
  })
})

const SUMMARY = {
  assetProfile: { sector: 'Consumer Cyclical', industry: 'Internet Retail', country: 'Uruguay', website: 'https://www.mercadolibre.com', fullTimeEmployees: 123670 },
  price: { quoteType: 'EQUITY', longName: 'MercadoLibre, Inc.', shortName: 'MercadoLibre', currency: 'USD', marketCap: 84163280896, regularMarketPrice: 1660.13 },
  summaryDetail: { fiftyTwoWeekLow: 1495, fiftyTwoWeekHigh: 2419.78, beta: 1.308 },
  financialData: { targetMeanPrice: 2271.932, numberOfAnalystOpinions: 26, recommendationKey: 'strong_buy', financialCurrency: 'USD' },
  defaultKeyStatistics: { sharesOutstanding: 50696802, floatShares: 50585269 },
  calendarEvents: { earnings: { earningsDate: [new Date('2001-11-04T20:00:00Z'), new Date('2099-11-04T20:00:00Z')] } },
  earningsHistory: {
    history: [
      { quarter: new Date('2026-06-30T00:00:00Z'), epsEstimate: 8.88879, epsActual: 9.19 },
      { quarter: new Date('2025-06-30T00:00:00Z'), epsEstimate: 9.5, epsActual: 10.31 },
      { quarter: new Date('2025-09-30T00:00:00Z'), epsEstimate: 9.29696, epsActual: 8.32 },
      { quarter: new Date('2025-12-31T00:00:00Z'), epsEstimate: 11.43736, epsActual: 11.03 },
      { quarter: new Date('2026-03-31T00:00:00Z'), epsActual: 8.23 },
    ],
  },
}

describe('fetchYahooProfile', () => {
  it('reads the profile from one quoteSummary call, with the next earnings date and the last four quarters oldest first', async () => {
    const { yf, getYahoo } = fakeYahoo({ qs: () => SUMMARY })

    const profile = await fetchYahooProfile('MELI', { getYahoo })

    expect(profile).toEqual({
      longName: 'MercadoLibre, Inc.',
      sector: 'Consumer Cyclical',
      industry: 'Internet Retail',
      country: 'Uruguay',
      website: 'https://www.mercadolibre.com',
      fullTimeEmployees: 123670,
      currency: 'USD',
      financialCurrency: 'USD',
      marketCap: 84163280896,
      fiftyTwoWeekLow: 1495,
      fiftyTwoWeekHigh: 2419.78,
      regularMarketPrice: 1660.13,
      targetMeanPrice: 2271.932,
      numberOfAnalystOpinions: 26,
      recommendationKey: 'strong_buy',
      sharesOutstanding: 50696802,
      floatShares: 50585269,
      beta: 1.308,
      // A date already past is not the next one.
      nextEarningsDate: '2099-11-04',
      earnings: [
        { quarterEnd: '2025-09-30', epsEstimate: 9.29696, epsActual: 8.32 },
        { quarterEnd: '2025-12-31', epsEstimate: 11.43736, epsActual: 11.03 },
        { quarterEnd: '2026-03-31', epsEstimate: null, epsActual: 8.23 },
        { quarterEnd: '2026-06-30', epsEstimate: 8.88879, epsActual: 9.19 },
      ],
      kind: 'company', dayChange: null, circulatingSupply: null, volume24h: null, fund: null,
    })
    expect(yf.quoteSummary).toHaveBeenCalledTimes(1)
    expect(yf.quoteSummary).toHaveBeenCalledWith(
      'MELI',
      {
        modules: [
          'assetProfile', 'price', 'summaryDetail', 'financialData', 'defaultKeyStatistics', 'calendarEvents', 'earningsHistory', 'topHoldings', 'fundProfile',
        ],
      },
      { validateResult: false },
    )
  })

  it('answers null for whatever Yahoo leaves out (an ETF has no profile, analysts or earnings)', async () => {
    const { getYahoo } = fakeYahoo({
      qs: () => ({ price: { longName: 'SPDR S&P 500 ETF Trust', currency: 'USD', regularMarketPrice: 769.36 }, summaryDetail: {} }),
    })

    const profile = await fetchYahooProfile('SPY', { getYahoo })

    expect(profile).toEqual({
      longName: 'SPDR S&P 500 ETF Trust',
      sector: null, industry: null, country: null, website: null, fullTimeEmployees: null,
      currency: 'USD', financialCurrency: null, marketCap: null,
      fiftyTwoWeekLow: null, fiftyTwoWeekHigh: null, regularMarketPrice: 769.36,
      targetMeanPrice: null, numberOfAnalystOpinions: null, recommendationKey: null,
      sharesOutstanding: null, floatShares: null, beta: null,
      nextEarningsDate: null, earnings: [],
      kind: 'other', dayChange: null, circulatingSupply: null, volume24h: null, fund: null,
    })
  })

  it("names the asset's kind from Yahoo's quoteType (T10)", async () => {
    const cases = [['EQUITY', 'company'], ['ETF', 'etf'], ['MUTUALFUND', 'etf'], ['CRYPTOCURRENCY', 'crypto'], ['INDEX', 'other'], [undefined, 'other']]
    for (const [quoteType, kind] of cases) {
      const { getYahoo } = fakeYahoo({ qs: () => ({ price: { quoteType } }) })
      expect((await fetchYahooProfile('X', { getYahoo })).kind).toBe(kind)
    }
  })

  it("keeps an ETF's facts and composition, compact: 15 holdings at most, sectors by Yahoo's names, largest first", async () => {
    const holdings = Array.from({ length: 20 }, (_, i) => ({ symbol: `H${i}`, holdingName: `Holding ${i}`, holdingPercent: (20 - i) / 1000 }))
    const { getYahoo } = fakeYahoo({
      qs: () => ({
        price: { quoteType: 'ETF', longName: 'SPDR S&P 500 ETF Trust', currency: 'USD', regularMarketPrice: 757.32 },
        summaryDetail: { fiftyTwoWeekLow: 629.28, fiftyTwoWeekHigh: 781.62, yield: 0.0099, totalAssets: 1 },
        fundProfile: { family: 'State Street', categoryName: 'Large Blend', feesExpensesInvestment: { annualReportExpenseRatio: 0.000945 } },
        defaultKeyStatistics: {
          ytdReturn: 0.1414, threeYearAverageReturn: 0.2493, fiveYearAverageReturn: 0.125, totalAssets: 809216114688, yield: 0.0099,
          fundInceptionDate: new Date('1993-01-22T00:00:00Z'),
        },
        topHoldings: {
          holdings: [{ symbol: 'BAD', holdingPercent: 'n/a' }, { symbol: '', holdingName: 'Cash', holdingPercent: 0.05 }, ...holdings],
          sectorWeightings: [{ realestate: 0.017 }, { technology: 0.4045 }, { consumer_cyclical: 0.0874 }, { utilities: 0 }],
        },
      }),
    })

    const profile = await fetchYahooProfile('SPY', { getYahoo })

    expect(profile.kind).toBe('etf')
    expect(profile.fund).toEqual({
      category: 'Large Blend', family: 'State Street', inceptionDate: '1993-01-22', expenseRatio: 0.000945,
      totalAssets: 809216114688, yield: 0.0099, ytdReturn: 0.1414, threeYearReturn: 0.2493, fiveYearReturn: 0.125,
      holdings: [
        { symbol: null, name: 'Cash', weight: 0.05 },
        ...holdings.slice(0, 14).map((h) => ({ symbol: h.symbol, name: h.holdingName, weight: h.holdingPercent })),
      ],
      sectors: [{ sector: 'Technology', weight: 0.4045 }, { sector: 'Consumer Cyclical', weight: 0.0874 }, { sector: 'Real Estate', weight: 0.017 }],
    })
    expect(JSON.stringify(profile).length).toBeLessThan(3_000)
  })

  it("keeps a crypto's day change, circulating supply and 24 h volume; no fund", async () => {
    const { getYahoo } = fakeYahoo({
      qs: () => ({
        price: {
          quoteType: 'CRYPTOCURRENCY', longName: 'Bitcoin USD', currency: 'USD', regularMarketPrice: 77319.46,
          regularMarketChange: -3853.5703, regularMarketChangePercent: -0.04747353, marketCap: 1555248578560,
        },
        summaryDetail: { fiftyTwoWeekLow: 57747.766, fiftyTwoWeekHigh: 111167.31, circulatingSupply: 20105364, volume24Hr: 59247714304 },
      }),
    })

    const profile = await fetchYahooProfile('BTC-USD', { getYahoo })

    expect(profile).toMatchObject({
      kind: 'crypto', regularMarketPrice: 77319.46, marketCap: 1555248578560, dayChange: { abs: -3853.5703, pct: -0.04747353 },
      circulatingSupply: 20105364, volume24h: 59247714304, fiftyTwoWeekLow: 57747.766, fiftyTwoWeekHigh: 111167.31, fund: null,
    })
  })

  it('is not_found when Yahoo has no such symbol, unavailable when the network fails', async () => {
    const missing = fakeYahoo({ qs: () => { throw new Error('Quote not found for symbol: ZZZZ') } })
    const down = fakeYahoo({ qs: () => { throw new Error('getaddrinfo ENOTFOUND query2.finance.yahoo.com') } })

    expect(await fetchYahooProfile('ZZZZ', { getYahoo: missing.getYahoo }).catch(e => e)).toMatchObject({ source: 'yahoo', code: 'not_found' })
    expect(await fetchYahooProfile('MELI', { getYahoo: down.getYahoo }).catch(e => e)).toMatchObject({ source: 'yahoo', code: 'unavailable' })
  })
})
