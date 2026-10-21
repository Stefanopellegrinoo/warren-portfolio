import { describe, it, expect } from 'vitest'
import { dcf, defaultDayCount, buildFlows, type FlowTerms, type RawFlow } from './bond-math'

describe('dcf', () => {
  it('30/360 (bond basis): six months is exactly 0.5', () => {
    expect(dcf('30/360', '2026-01-15', '2026-07-15')).toBeCloseTo(0.5, 12)
  })

  it('30/360 clamps day 31 (end of month to end of month)', () => {
    // 2026-01-31 -> 2026-03-31 = 60/360
    expect(dcf('30/360', '2026-01-31', '2026-03-31')).toBeCloseTo(60 / 360, 12)
    // d1 < 30 keeps d2 = 31: 2026-01-15 -> 2026-03-31 = (2*30 + 16)/360
    expect(dcf('30/360', '2026-01-15', '2026-03-31')).toBeCloseTo(76 / 360, 12)
  })

  it('ACT/365 uses actual days over 365', () => {
    expect(dcf('ACT/365', '2025-12-10', '2026-09-10')).toBeCloseTo(274 / 365, 12)
  })

  it('ACT/360 uses actual days over 360', () => {
    expect(dcf('ACT/360', '2026-09-10', '2026-10-21')).toBeCloseTo(41 / 360, 12)
  })

  it('ACT/ACT (ISDA) splits the period by year length', () => {
    // 2023-07-01 -> 2024-07-01: 184 days in 2023, 182 days in 2024 (leap)
    expect(dcf('ACT/ACT', '2023-07-01', '2024-07-01')).toBeCloseTo(184 / 365 + 182 / 366, 12)
  })

  it('returns 0 for an empty period', () => {
    expect(dcf('ACT/365', '2026-01-01', '2026-01-01')).toBe(0)
  })
})

describe('defaultDayCount', () => {
  it('ARG law -> ACT/365, NY law -> 30/360', () => {
    expect(defaultDayCount('ARG')).toBe('ACT/365')
    expect(defaultDayCount('NY')).toBe('30/360')
  })
})

const base: FlowTerms = {
  issueDate: '2025-12-10',
  rateType: 'fixed',
  couponPct: 7.25,
  dayCount: 'ACT/365',
  bdc: 'following',
  maturityBdc: 'following',
  recordOffsetDays: null,
}

describe('buildFlows - fixed rate', () => {
  // CS50-like public terms: 7.25%, ACT/365, issued 2025-12-10, first coupon 2026-09-10.
  const raw: RawFlow[] = [
    { date: '2026-09-10', ren: 3.625, amo: 0 },
    { date: '2027-03-10', ren: 3.625, amo: 0 },
    { date: '2027-09-10', ren: 3.625, amo: 100 },
  ]

  it('first coupon covers the long first period (issue date to first date)', () => {
    const flows = buildFlows(base, raw)
    expect(flows[0].couponPct).toBeCloseTo((7.25 * 274) / 365, 10)
    expect(flows[0].couponSource).toBe('computed')
  })

  it('regular coupon is cup x actual days / 365, not cup/2', () => {
    const flows = buildFlows(base, raw)
    expect(flows[1].couponPct).toBeCloseTo((7.25 * 181) / 365, 10)
  })

  it('leap-year period uses the actual 366 days', () => {
    const flows = buildFlows(
      { ...base, issueDate: '2024-01-15' },
      [{ date: '2025-01-15', ren: 0, amo: 100 }]
    )
    expect(flows[0].couponPct).toBeCloseTo((7.25 * 366) / 365, 10)
  })

  it('NY-law default 30/360 regular semiannual coupon equals cup/2', () => {
    const terms: FlowTerms = {
      ...base,
      issueDate: '2025-03-15',
      couponPct: 8,
      dayCount: defaultDayCount('NY'),
    }
    const flows = buildFlows(terms, [
      { date: '2025-09-15', ren: 4, amo: 0 },
      { date: '2026-03-15', ren: 4, amo: 100 },
    ])
    expect(flows.map((f) => f.couponPct)).toEqual([4, 4])
  })

  it('bullet bond: adds one 100% amortization at maturity', () => {
    const flows = buildFlows(base, raw)
    expect(flows.map((f) => f.amortPct)).toEqual([0, 0, 100])
    const noAmo = buildFlows(base, raw.map((r) => ({ ...r, amo: 0 })))
    expect(noAmo.map((f) => f.amortPct)).toEqual([0, 0, 100])
  })

  it('amortizing (33/33/34): coupons on the residual before each period', () => {
    const terms: FlowTerms = {
      ...base,
      issueDate: '2035-04-15',
      couponPct: 5,
      dayCount: '30/360',
    }
    const flows = buildFlows(terms, [
      { date: '2036-04-15', ren: 5, amo: 33 },
      { date: '2037-04-15', ren: 3.35, amo: 33 },
      { date: '2038-04-15', ren: 1.7, amo: 34 },
    ])
    expect(flows.map((f) => f.residualBeforePct)).toEqual([100, 67, 34])
    expect(flows.map((f) => f.couponPct)).toEqual([5, 3.35, 1.7])
    expect(flows.reduce((s, f) => s + f.amortPct, 0)).toBe(100)
  })

  it('zero coupon: only the redemption flow', () => {
    const flows = buildFlows(
      { ...base, couponPct: 0 },
      [{ date: '2027-03-10', ren: 0, amo: 100 }]
    )
    expect(flows).toHaveLength(1)
    expect(flows[0]).toMatchObject({ couponPct: 0, amortPct: 100, residualBeforePct: 100 })
  })

  it('computes accrual on unadjusted dates but exposes the adjusted pay date', () => {
    // 2026-09-12 is a Saturday: paid Monday 2026-09-14, no extra interest.
    const flows = buildFlows(base, [{ date: '2026-09-12', ren: 0, amo: 100 }])
    expect(flows[0].date).toBe('2026-09-12')
    expect(flows[0].payDate).toBe('2026-09-14')
    expect(flows[0].couponPct).toBeCloseTo((7.25 * dcfDays('2025-12-10', '2026-09-12')) / 365, 10)
  })

  it('maturity uses maturity_bdc, intermediate dates use bdc', () => {
    const flows = buildFlows(
      { ...base, maturityBdc: 'preceding' },
      [
        { date: '2026-09-12', ren: 0, amo: 0 },
        { date: '2027-03-13', ren: 0, amo: 100 },
      ]
    )
    expect(flows[0].payDate).toBe('2026-09-14') // following
    expect(flows[1].payDate).toBe('2027-03-12') // preceding (Saturday -> Friday)
  })

  it('record date is the offset in CALENDAR days before the unadjusted date', () => {
    const [f] = buildFlows(
      { ...base, recordOffsetDays: 15 },
      [{ date: '2026-09-10', ren: 0, amo: 100 }]
    )
    expect(f.recordDate).toBe('2026-08-26')
  })

  it('without offset the record date equals the unadjusted date', () => {
    const [f] = buildFlows(base, [{ date: '2026-09-10', ren: 0, amo: 100 }])
    expect(f.recordDate).toBe('2026-09-10')
  })

  it('sorts raw rows by date', () => {
    const flows = buildFlows(base, [...raw].reverse())
    expect(flows.map((f) => f.date)).toEqual(['2026-09-10', '2027-03-10', '2027-09-10'])
  })
})

describe('buildFlows - record date, residual, merging', () => {
  it('record date may land on a non-business day (sea o no un Dia Habil)', () => {
    const [f] = buildFlows(
      { ...base, recordOffsetDays: 1 },
      [{ date: '2026-07-09', ren: 0, amo: 100 }]
    )
    expect(f.payDate).toBe('2026-07-13')
    expect(f.recordDate).toBe('2026-07-08') // calendar day before the unadjusted date
    const [g] = buildFlows(
      { ...base, recordOffsetDays: 4 },
      [{ date: '2026-09-10', ren: 0, amo: 100 }]
    )
    expect(g.recordDate).toBe('2026-09-06') // a Sunday, valid
  })

  it('does not accumulate float drift in the residual', () => {
    const flows = buildFlows(base, [
      { date: '2026-03-10', ren: 0, amo: 33.33 },
      { date: '2026-06-10', ren: 0, amo: 33.33 },
      { date: '2026-09-10', ren: 0, amo: 33.33 },
      { date: '2026-12-10', ren: 0, amo: 0.01 },
    ])
    expect(flows[3].residualBeforePct).toBe(0.01)
    expect(flows[3].amortPct).toBe(0.01)
  })

  it('merges rows with the same date (sums ren and amo)', () => {
    const flows = buildFlows(
      { ...base, rateType: 'byma' },
      [
        { date: '2026-09-10', ren: 2, amo: 0 },
        { date: '2026-09-10', ren: 1, amo: 40 },
        { date: '2027-03-10', ren: 1, amo: 60 },
      ]
    )
    expect(flows).toHaveLength(2)
    expect(flows[0]).toMatchObject({ couponPct: 3, amortPct: 40 })
    expect(flows[1].residualBeforePct).toBe(60)
  })

  it('byma rateType with no amortization gets a bullet at the last date', () => {
    const flows = buildFlows(
      { ...base, rateType: 'byma' },
      [
        { date: '2026-09-10', ren: 2, amo: 0 },
        { date: '2027-03-10', ren: 4, amo: 0 },
      ]
    )
    expect(flows.map((f) => f.amortPct)).toEqual([0, 100])
    expect(flows.map((f) => f.couponPct)).toEqual([2, 4])
  })
})

describe('buildFlows - seasoned bonds (residualPct, accrualStart)', () => {
  const terms: FlowTerms = { ...base, rateType: 'fixed', couponPct: 8, dayCount: '30/360', issueDate: '2026-01-16' }

  it('computes coupons on the real residual of a partially amortized bond (BYMA vr 82)', () => {
    const raw: RawFlow[] = [
      { date: '2027-01-16', ren: 0, amo: 9 },
      { date: '2027-04-16', ren: 0, amo: 73 },
    ]
    const flows = buildFlows({ ...terms, residualPct: 82, accrualStart: '2026-10-16' }, raw)
    expect(flows[0].residualBeforePct).toBe(82)
    expect(flows[0].couponPct).toBeCloseTo((8 * 0.25 * 82) / 100, 10)
    expect(flows[1].residualBeforePct).toBe(73)
    expect(flows[1].couponPct).toBeCloseTo((8 * 0.25 * 73) / 100, 10)
  })

  it('accrualStart (not issueDate) starts the first live coupon period', () => {
    const raw: RawFlow[] = [{ date: '2027-01-16', ren: 0, amo: 100 }]
    const flows = buildFlows({ ...terms, accrualStart: '2026-10-16' }, raw)
    expect(flows[0].couponPct).toBeCloseTo(8 * 0.25, 10)
  })

  it('a bullet on a residual below 100 redeems the residual', () => {
    const flows = buildFlows({ ...terms, residualPct: 82 }, [{ date: '2027-01-16', ren: 0, amo: 0 }])
    expect(flows[0].amortPct).toBe(82)
  })
})

describe('date validation and extra day counts', () => {
  it('rejects malformed and rolled-over dates', () => {
    expect(() => dcf('ACT/365', '2026-02-30', '2026-03-01')).toThrow(/invalid ISO date/)
    expect(() => dcf('ACT/365', '2026-01-01', '2026-13-01')).toThrow(/invalid ISO date/)
  })

  it('rejects from > to', () => {
    expect(() => dcf('ACT/365', '2026-03-01', '2026-01-01')).toThrow(/is after/)
  })

  it('ACT/ACT over more than two years and with a leap start year', () => {
    expect(dcf('ACT/ACT', '2023-07-01', '2026-07-01')).toBeCloseTo(3, 12)
    expect(dcf('ACT/ACT', '2024-07-01', '2025-07-01')).toBeCloseTo(184 / 366 + 181 / 365, 12)
  })

  it('30/360 with d1=30,d2=31 and February (no end-of-February rule)', () => {
    expect(dcf('30/360', '2026-01-30', '2026-03-31')).toBeCloseTo(60 / 360, 12)
    expect(dcf('30/360', '2026-01-31', '2026-02-28')).toBeCloseTo(28 / 360, 12)
    expect(dcf('30/360', '2026-02-28', '2026-03-28')).toBeCloseTo(30 / 360, 12)
  })
})

describe('buildFlows - step-up / non fixed', () => {
  it('uses BYMA ren as given with couponSource byma', () => {
    const flows = buildFlows(
      { ...base, rateType: 'byma' },
      [
        { date: '2026-09-10', ren: 2, amo: 0 },
        { date: '2027-03-10', ren: 4, amo: 0 },
        { date: '2027-09-10', ren: 6, amo: 100 },
      ]
    )
    expect(flows.map((f) => f.couponPct)).toEqual([2, 4, 6])
    expect(flows.every((f) => f.couponSource === 'byma')).toBe(true)
  })
})

describe('timezone safety', () => {
  const raw: RawFlow[] = [
    { date: '2026-09-10', ren: 0, amo: 0 },
    { date: '2027-03-10', ren: 0, amo: 100 },
  ]
  const run = (tz: string) => {
    const prev = process.env.TZ
    process.env.TZ = tz
    try {
      return JSON.stringify([buildFlows(base, raw), dcf('ACT/ACT', '2023-07-01', '2024-07-01')])
    } finally {
      if (prev === undefined) delete process.env.TZ
      else process.env.TZ = prev
    }
  }

  it('gives identical output under UTC and America/Argentina/Buenos_Aires', () => {
    expect(run('UTC')).toBe(run('America/Argentina/Buenos_Aires'))
  })
})

function dcfDays(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000
}
