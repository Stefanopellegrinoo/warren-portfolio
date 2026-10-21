import { describe, it, expect } from 'vitest'
import oracle from './__fixtures__/byma-oracle.json'
import { extractPayload, parseBymaPayload, accrualStartOf, BymaParseError } from './byma-educa'

type Row = Record<string, unknown>

// Public BYMA rows from the oracle fixture, plus the fields the fixture does not keep.
const base = oracle.rows as Row[]
const mk = (r: Row, i: number): Row => ({
  ...r,
  seg: 'hd',
  em: 'EMISOR S.A.',
  de: `Clase ${i}`,
  mp: 'MEP',
  mto: 1_000_000,
  adtvp: [1, 2, 3],
  adtve: [`${r.tk}`, `${String(r.tk).slice(0, -1)}D`, `${String(r.tk).slice(0, -1)}C`],
})
const rows = (n = 228): Row[] => base.slice(0, n).map(mk)
const sov = (): Row[] => [
  { tk: 'GD30', seg: 'sob', ley: 'NY', me: 'USD', isin: 'ARARGE3209S6', px: 80, ytm: 9.5, dm: 2.1 },
  { tk: 'AL30', seg: 'sob', ley: 'ARG', me: 'USD', isin: 'ARARGE3209S7', px: 79, ytm: 9.7, dm: 2.0 },
  { tk: 'GD35', seg: 'sob', ley: 'NY', me: 'USD', isin: 'ARARGE3209S9', px: 70, ytm: 10, dm: 5 },
  { tk: 'GD38', seg: 'sob', ley: 'NY', me: 'USD', isin: 'ARARGE3209T0', px: 72, ytm: 10.2, dm: 6 },
  { tk: 'GD41', seg: 'sob', ley: 'NY', me: 'USD', isin: 'ARARGE3209T1', px: 68, ytm: 10.4, dm: 7 },
  { tk: 'X', seg: 'ars', ley: 'ARG', me: 'ARS', isin: 'ARARGE3209S8', px: 1, ytm: 1, dm: 1 },
]
const payload = (o: { rows?: Row[]; tp?: unknown } = {}) => ({
  on: { fecha: '2026-10-20', fecha_liq: '2026-10-21', rows: o.rows ?? rows() },
  ...('tp' in o ? (o.tp === undefined ? {} : { tp: o.tp }) : { tp: { fecha: '2026-10-20', rows: sov() } }),
})
const html = (p: unknown) => `<html><script id="payload" type="application/json">${JSON.stringify(p)}</script></html>`

describe('extractPayload', () => {
  it('extracts the JSON of the payload script', () => {
    expect(extractPayload(html({ a: 1 }))).toEqual({ a: 1 })
  })
  it('aborts when the script is missing', () => {
    expect(() => extractPayload('<html></html>')).toThrow(BymaParseError)
  })
  it('aborts on a JSON parse error', () => {
    expect(() => extractPayload('<script id="payload" type="application/json">{oops</script>')).toThrow(BymaParseError)
  })
})

describe('parseBymaPayload', () => {
  it('maps valid rows, dates and sovereign curve', () => {
    const r = parseBymaPayload(payload())
    expect(r.asOf).toBe('2026-10-20')
    expect(r.settle).toBe('2026-10-21')
    expect(r.ons).toHaveLength(228)
    expect(r.skipped).toEqual([])
    expect(r.sov.map((s) => s.ticker)).toEqual(['GD30', 'AL30', 'GD35', 'GD38', 'GD41'])
    expect(r.sov[0]).toMatchObject({ law: 'NY', ytm: 9.5, dm: 2.1 })
    expect(r.sovMissing).toBe(false)
  })

  it('maps one row: tickers from adtve, plaza from mp, adtv per line, flows raw', () => {
    const cs = parseBymaPayload(payload()).ons.find((o) => o.tickerO === 'CS50O')!
    expect(cs).toMatchObject({
      isin: 'AR0394353335',
      tickerD: 'CS50D',
      tickerC: 'CS50C',
      law: 'ARG',
      paymentPlaza: 'MEP',
      frequency: 'Semestral',
      residualPct: 100,
      issuedAmountByma: 1_000_000,
      adtvO: 1,
      adtvD: 2,
      adtvC: 3,
    })
    expect(cs.flows[0]).toEqual({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), ren: expect.any(Number), amo: expect.any(Number) })
  })

  it('keeps nulls: missing mp -> plaza null, missing adtv -> null', () => {
    const r = rows()
    r[0] = { ...r[0], mp: null, adtvp: [null, 5, 6] }
    const o = parseBymaPayload(payload({ rows: r })).ons[0]
    expect(o.paymentPlaza).toBeNull()
    expect(o.adtvO).toBeNull()
    expect(o.adtvD).toBe(5)
  })

  it('skips and reports 5 bad rows of 250', () => {
    const r = [...rows(), ...rows(22).map((x, i) => ({ ...x, tk: `ZZ${i}O`, isin: `AR00000000${String(i).padStart(2, '0')}` }))]
    r[0] = { ...r[0], isin: 'bad' }
    r[1] = { ...r[1], ley: 'XX' }
    r[2] = { ...r[2], ren: 'nope' }
    r[3] = { ...r[3], fv: '2029/01/01' }
    r[4] = { ...r[4], px: 'x' }
    const res = parseBymaPayload(payload({ rows: r }))
    expect(res.ons).toHaveLength(245)
    expect(res.skipped).toHaveLength(5)
    expect(res.skipped[0]).toMatchObject({ tk: r[0].tk })
    expect(res.skipped[0].reason).toEqual(expect.any(String))
  })

  it('aborts with fewer than 200 valid rows', () => {
    expect(() => parseBymaPayload(payload({ rows: rows(199) }))).toThrow(/200/)
  })

  it('aborts when more than 10% of rows are invalid', () => {
    const r = rows()
    for (let i = 0; i < 30; i++) r[i] = { ...r[i], isin: 'bad' }
    expect(() => parseBymaPayload(payload({ rows: r }))).toThrow(/invalid/i)
  })

  it('aborts on a structurally broken payload', () => {
    expect(() => parseBymaPayload({})).toThrow(BymaParseError)
    expect(() => parseBymaPayload({ on: { rows: 'x' } })).toThrow(BymaParseError)
  })

  it('missing tp keeps the curve: sovMissing and no throw', () => {
    const r = parseBymaPayload(payload({ tp: undefined }))
    expect(r.sovMissing).toBe(true)
    expect(r.sov).toEqual([])
    expect(r.ons).toHaveLength(228)
  })

  it('a broken tp does not abort the ON data', () => {
    const r = parseBymaPayload(payload({ tp: { rows: 'x' } }))
    expect(r.sovMissing).toBe(true)
  })
})

describe('hardening', () => {
  it('aborts on schema drift: a critical key absent from every row', () => {
    const r = rows().map((x) => {
      const { vr: _vr, ...rest } = x
      return rest
    })
    expect(() => parseBymaPayload(payload({ rows: r }))).toThrow(/schema drift.*vr/i)
  })
  it('aborts on schema drift above 10% of rows, tolerates a few', () => {
    const drop = (n: number) => rows().map((x, i) => (i < n ? (({ cup: _c, ...rest }) => rest)(x) : x))
    expect(() => parseBymaPayload(payload({ rows: drop(30) }))).toThrow(/schema drift.*cup/i)
    expect(parseBymaPayload(payload({ rows: drop(3) })).ons.length).toBe(228)
  })
  it('a null cup (zero-coupon) is not drift', () => {
    const r = rows().map((x) => ({ ...x, cup: null }))
    expect(parseBymaPayload(payload({ rows: r })).ons).toHaveLength(228)
  })
  it('dedupes by isin keeping the first and reporting the duplicate', () => {
    const r = [...rows(), { ...rows()[0], tk: 'DUPEO' }]
    const res = parseBymaPayload(payload({ rows: r }))
    expect(res.ons).toHaveLength(228)
    expect(res.ons[0].tickerO).toBe(rows()[0].tk)
    expect(res.skipped).toEqual([{ tk: 'DUPEO', reason: expect.stringMatching(/duplicate isin/i) }])
  })
  it('dedupes sovereign rows by ticker', () => {
    const tp = { rows: [...sov(), { ...sov()[0], ytm: 1 }] }
    const res = parseBymaPayload(payload({ tp }))
    expect(res.sov.filter((x) => x.ticker === 'GD30')).toHaveLength(1)
    expect(res.sov.find((x) => x.ticker === 'GD30')!.ytm).toBe(9.5)
    expect(res.sovSkipped).toEqual([{ tk: 'GD30', reason: expect.stringMatching(/duplicate/i) }])
  })
  it('fewer than 5 sovereign rows keeps the last-good curve', () => {
    const tp = { rows: sov().slice(0, 4) }
    const res = parseBymaPayload(payload({ tp }))
    expect(res.sovMissing).toBe(true)
    expect(res.sov).toEqual([])
  })
  it('rejects impossible calendar dates', () => {
    const r = rows()
    r[0] = { ...r[0], fv: '2026-13-45' }
    r[1] = { ...r[1], fe: '2026-02-30' }
    const res = parseBymaPayload(payload({ rows: r }))
    expect(res.skipped.map((s) => s.tk)).toEqual([r[0].tk, r[1].tk])
  })
  it('skips rows whose numbers overflow the NUMERIC columns', () => {
    const r = rows()
    r[0] = { ...r[0], px: 1e12 }
    r[1] = { ...r[1], cup: 50_000 }
    r[2] = { ...r[2], ren: [['2027-01-01', 1e9]] }
    const res = parseBymaPayload(payload({ rows: r }))
    expect(res.skipped).toHaveLength(3)
    expect(res.ons).toHaveLength(225)
  })
  it('does not fabricate D/C tickers when adtve is missing', () => {
    const r = rows()
    r[0] = { ...r[0], adtve: null }
    const o = parseBymaPayload(payload({ rows: r })).ons[0]
    expect(o.tickerO).toBe(r[0].tk)
    expect(o.tickerD).toBeNull()
    expect(o.tickerC).toBeNull()
  })
})

describe('real payload quirks', () => {
  it('a line without ticker (adtve null entry) is valid and maps to null', () => {
    const r = rows()
    r[0] = { ...r[0], adtve: [r[0].tk, `${String(r[0].tk).slice(0, -1)}D`, null] }
    const res = parseBymaPayload(payload({ rows: r }))
    expect(res.skipped).toEqual([])
    expect(res.ons[0].tickerC).toBeNull()
    expect(res.ons[0].tickerD).toBe(`${String(r[0].tk).slice(0, -1)}D`)
  })
  it('abort message carries sample reasons', () => {
    const r = rows().map((x) => ({ ...x, ley: 'XX' }))
    expect(() => parseBymaPayload(payload({ rows: r }))).toThrow(/ley/)
  })
})

describe('accrualStartOf', () => {
  it('first listed flow minus one period', () => {
    expect(accrualStartOf('Semestral', '2025-12-10', ['2027-03-10', '2027-09-10'], '2026-10-21')).toBe('2026-09-10')
    expect(accrualStartOf('Trimestral', '2025-01-01', ['2026-11-15'], '2026-10-21')).toBe('2026-08-15')
  })
  it('clamped to the issue date', () => {
    expect(accrualStartOf('Semestral', '2026-08-06', ['2027-02-06'], '2026-10-21')).toBe('2026-08-06')
    expect(accrualStartOf('Semestral', '2026-09-20', ['2027-02-06'], '2026-10-21')).toBe('2026-09-20')
  })
  it('long first period (start after settle) falls back to the issue date', () => {
    expect(accrualStartOf('Semestral', '2026-10-20', ['2027-07-20'], '2026-10-21')).toBe('2026-10-20')
  })
  it('end-of-month day is clamped', () => {
    expect(accrualStartOf('Semestral', '2020-01-01', ['2026-12-31'], '2026-10-21')).toBe('2026-06-30')
  })
  it('no coupons or bullet: issue date', () => {
    expect(accrualStartOf('No Paga Cupon', '2025-01-01', ['2027-01-01'], '2026-10-21')).toBe('2025-01-01')
    expect(accrualStartOf('Semestral', '2025-01-01', [], '2026-10-21')).toBe('2025-01-01')
  })
})
