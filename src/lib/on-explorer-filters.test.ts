import { describe, it, expect } from 'vitest'
import type { OnListRow } from './on-analytics'
import { applyExplorer, parseExplorerQuery, serializeExplorerQuery, DEFAULT_STATE, issuersOf } from './on-explorer-filters'

const row = (over: Partial<OnListRow>): OnListRow => ({
  isin: 'AR0000000001',
  tickerO: 'AAAAO',
  tickerD: 'AAAAD',
  issuer: 'Alfa S.A.',
  description: null,
  currency: 'USD',
  currencyLabel: 'USD MEP',
  plaza: 'MEP',
  law: 'ARG',
  rateType: 'fixed',
  maturityDate: '2028-01-01',
  status: 'ok',
  simulable: true,
  price: 100,
  ytmPct: 8,
  mdYears: 2,
  paridadPct: 100,
  currentYieldPct: 7,
  walYears: 2,
  spreadBp: 100,
  adtvUsd: 1000,
  nextPayDate: '2027-01-01',
  nextPayAmountPct: 3,
  methodFlag: null,
  termsNote: null,
  events: [],
  ...over,
})

const rows = [
  row({ isin: 'AR0000000001', tickerO: 'AAAAO', ytmPct: 8, mdYears: 2, maturityDate: '2028-01-01' }),
  row({ isin: 'AR0000000002', tickerO: 'BBBBO', issuer: 'Beta S.A.', ytmPct: 10, mdYears: 4, law: 'NY', currencyLabel: 'USD cable', maturityDate: '2030-06-01' }),
  row({ isin: 'AR0000000003', tickerO: 'CCCCO', issuer: 'Gamma S.A.', status: 'no-price', ytmPct: null, mdYears: null, price: null, currencyLabel: 'ARS', currency: 'ARS', maturityDate: '2027-03-01' }),
  row({ isin: 'AR0000000004', tickerO: 'DDDDO', issuer: 'Delta S.A.', rateType: 'floating', status: 'floating', ytmPct: null, mdYears: null, price: null, simulable: false, maturityDate: '2029-01-01' }),
]
const ids = (rs: OnListRow[]) => rs.map((r) => r.isin.slice(-1))
const state = (f: object = {}, sort = DEFAULT_STATE.sort) => ({ filters: { ...DEFAULT_STATE.filters, ...f }, sort })

describe('applyExplorer: AND-combined filters', () => {
  it('returns every row with the default state, sorted by maturity', () => {
    expect(ids(applyExplorer(rows, DEFAULT_STATE))).toEqual(['3', '1', '4', '2'])
  })

  it('currency + rate type + YTM minimum', () => {
    expect(ids(applyExplorer(rows, state({ currency: 'USD MEP', rateType: 'fixed', ytmMin: 8 })))).toEqual(['1'])
  })

  it('no match gives an empty list', () => {
    expect(applyExplorer(rows, state({ ytmMin: 50 }))).toEqual([])
  })

  it('a YTM or duration range excludes rows without the value', () => {
    expect(ids(applyExplorer(rows, state({ ytmMin: 0 })))).toEqual(['1', '2'])
    expect(ids(applyExplorer(rows, state({ mdMax: 3 })))).toEqual(['1'])
  })

  it('maturity range, law and issuer', () => {
    expect(ids(applyExplorer(rows, state({ maturityFrom: '2028-01-01', maturityTo: '2029-12-31' })))).toEqual(['1', '4'])
    expect(ids(applyExplorer(rows, state({ law: 'NY' })))).toEqual(['2'])
    expect(ids(applyExplorer(rows, state({ issuer: 'Gamma S.A.' })))).toEqual(['3'])
  })

  it('search matches ticker, issuer or ISIN, ignoring case', () => {
    expect(ids(applyExplorer(rows, state({ q: 'bbbb' })))).toEqual(['2'])
    expect(ids(applyExplorer(rows, state({ q: 'delta' })))).toEqual(['4'])
    expect(ids(applyExplorer(rows, state({ q: 'ar0000000003' })))).toEqual(['3'])
  })
})

describe('applyExplorer: sorting', () => {
  it('sorts by YTM desc with null rows last', () => {
    expect(ids(applyExplorer(rows, state({}, { key: 'ytm', dir: 'desc' })))).toEqual(['2', '1', '3', '4'])
  })

  it('and also last when ascending', () => {
    expect(ids(applyExplorer(rows, state({}, { key: 'ytm', dir: 'asc' })))).toEqual(['1', '2', '3', '4'])
  })

  it('sorts text columns', () => {
    expect(ids(applyExplorer(rows, state({}, { key: 'issuer', dir: 'desc' })))).toEqual(['3', '4', '2', '1'])
  })

  it('does not mutate the input', () => {
    const copy = [...rows]
    applyExplorer(rows, state({}, { key: 'ytm', dir: 'desc' }))
    expect(rows).toEqual(copy)
  })
})

describe('URL state', () => {
  it('round-trips filters and sort', () => {
    const s = state({ q: 'cs', currency: 'USD MEP', ytmMin: 8, mdMax: 5.5, maturityFrom: '2027-01-01', law: 'ARG' }, { key: 'ytm', dir: 'desc' })
    expect(parseExplorerQuery(serializeExplorerQuery(s))).toEqual(s)
  })

  it('default state serializes to an empty query', () => {
    expect(serializeExplorerQuery(DEFAULT_STATE)).toBe('')
  })

  it('ignores junk: unknown sort key, bad numbers, bad dates, unknown law', () => {
    const s = parseExplorerQuery('sort=hack&dir=sideways&ytmMin=abc&maturityFrom=nope&law=XX&rateType=zzz')
    expect(s).toEqual(DEFAULT_STATE)
  })

  it('lists distinct issuers alphabetically', () => {
    expect(issuersOf(rows)).toEqual(['Alfa S.A.', 'Beta S.A.', 'Delta S.A.', 'Gamma S.A.'])
  })
})
