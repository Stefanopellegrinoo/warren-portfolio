import { describe, it, expect } from 'vitest'
import fixture from './__fixtures__/byma-oracle.json'
import { NON_PERIODIC_FC, PERIOD_MONTHS, accrualStartOf } from './byma-educa'
import { deriveBackwardFlows, loadFlowRows, mergeFlowHistory, type DerivationInput } from './on-flow-history'

const CS50: DerivationInput = {
  est: 'Tasa Fija',
  frequency: 'Semestral',
  couponRate: 0.0725,
  issueDate: '2025-12-10',
  accrualStart: '2026-09-10',
  residualPct: 100,
  dayCount: 'ACT/365',
  currentFlows: [
    { date: '2027-03-10', ren: 3.625, amo: 0 },
    { date: '2029-03-10', ren: 3.625, amo: 100 },
  ],
}

describe('PERIOD_MONTHS / fc coverage', () => {
  it('covers every fc value of the real BYMA payload fixture', () => {
    const fcs = new Set((fixture.rows as { fc?: string | null }[]).map((r) => r.fc).filter((x): x is string => !!x))
    expect(fcs.size).toBeGreaterThanOrEqual(4)
    for (const fc of fcs) expect(fc in PERIOD_MONTHS || NON_PERIODIC_FC.includes(fc), fc).toBe(true)
  })

  it('knows Mensual, Trimestral, Semestral and Anual', () => {
    expect(PERIOD_MONTHS).toMatchObject({ Mensual: 1, Trimestral: 3, Semestral: 6, Anual: 12 })
  })

  it('accrualStartOf steps back one month for Mensual', () => {
    expect(accrualStartOf('Mensual', '2026-05-10', ['2026-11-10'], '2026-10-21')).toBe('2026-10-10')
  })
})

describe('deriveBackwardFlows', () => {
  it('CS50 with the verified long first coupon: 7.25 x 274/365 (ACT/365), no phantom March coupon', () => {
    const r = deriveBackwardFlows({ ...CS50, firstCouponDate: '2026-09-10' })
    expect(r).toMatchObject({ ok: true, warnings: [] })
    if (!r.ok) return
    expect(r.flows).toHaveLength(1)
    expect(r.flows[0]).toMatchObject({ date: '2026-09-10', amo: 0, provenance: 'derived' })
    expect(r.flows[0].ren).toBeCloseTo(5.442466, 6) // 7.25 * 274 / 365
  })

  it('CS50 without the first coupon date: assumes the regular schedule and says so', () => {
    const r = deriveBackwardFlows(CS50)
    if (!r.ok) throw new Error('expected ok')
    expect(r.flows.map((f) => f.date)).toEqual(['2026-03-10', '2026-09-10'])
    expect(r.flows[0].ren).toBeCloseTo(1.787671, 6) // 7.25 * 90 / 365 (issue -> 03-10)
    expect(r.flows[1].ren).toBeCloseTo(3.654795, 6) // 7.25 * 184 / 365
    expect(r.warnings).toEqual(['first-period-assumed'])
  })

  it('quarterly 30/360 on a regular schedule: six coupons of 1.5, no warning', () => {
    const r = deriveBackwardFlows({ ...CS50, frequency: 'Trimestral', couponRate: 0.06, dayCount: '30/360', issueDate: '2025-01-15', accrualStart: '2026-07-15' })
    if (!r.ok) throw new Error('expected ok')
    expect(r.flows.map((f) => f.date)).toEqual(['2025-04-15', '2025-07-15', '2025-10-15', '2026-01-15', '2026-04-15', '2026-07-15'])
    for (const f of r.flows) expect(f.ren).toBeCloseTo(1.5, 9) // 6 x 90/360
    expect(r.warnings).toEqual([])
  })

  it('steps from the anchor, not from the previous step (no month-end drift)', () => {
    const r = deriveBackwardFlows({ ...CS50, couponRate: 0.06, dayCount: '30/360', issueDate: '2025-04-01', accrualStart: '2026-08-31' })
    if (!r.ok) throw new Error('expected ok')
    // 2026-02-28 is the clamped step; the next one must be 2025-08-31, not 2025-08-28
    expect(r.flows.map((f) => f.date)).toEqual(['2025-08-31', '2026-02-28', '2026-08-31'])
    expect(r.flows.map((f) => f.ren)).toEqual([2.5, 2.966667, 3.05]) // 150/360, 178/360, 183/360 of 6
    expect(r.warnings).toEqual(['first-period-assumed'])
  })

  it('monthly: three coupons, ACT/365', () => {
    const r = deriveBackwardFlows({ ...CS50, frequency: 'Mensual', couponRate: 0.12, issueDate: '2026-05-10', accrualStart: '2026-08-10' })
    if (!r.ok) throw new Error('expected ok')
    expect(r.flows.map((f) => f.date)).toEqual(['2026-06-10', '2026-07-10', '2026-08-10'])
    expect(r.flows.map((f) => f.ren)).toEqual([1.019178, 0.986301, 1.019178]) // 12 x 31/365, 30/365, 31/365
  })

  it('nothing precedes the issue date: accrual_start == issue yields no flows (DNCB-like)', () => {
    const r = deriveBackwardFlows({ ...CS50, issueDate: '2026-07-03', accrualStart: '2026-07-03', couponRate: 0.075 })
    expect(r).toEqual({ ok: true, flows: [], warnings: [] })
  })

  it('zero-coupon and interest-at-maturity bonds have no past periodic flows', () => {
    expect(deriveBackwardFlows({ ...CS50, est: 'Cupon Cero', frequency: 'No Paga Cupon', couponRate: null, accrualStart: '2025-12-10' })).toMatchObject({ ok: true, flows: [] })
    expect(deriveBackwardFlows({ ...CS50, frequency: 'Vencimiento', accrualStart: '2025-12-10' })).toMatchObject({ ok: true, flows: [] })
  })

  it.each([
    ['step-up', { est: 'Step Up' }, 'step-up'],
    ['floating', { est: 'Tasa Variable' }, 'floating'],
    ['unknown rate type', { est: null }, 'unsupported-rate-type'],
    ['amortized: residual below 100', { residualPct: 80 }, 'amortized'],
    ['amortized: schedule with two amortizations', { currentFlows: [{ date: '2027-03-10', ren: 1, amo: 50 }, { date: '2027-09-10', ren: 1, amo: 50 }] }, 'amortized'],
    ['unknown frequency', { frequency: 'Quincenal' }, 'unknown-frequency'],
    ['null frequency', { frequency: null }, 'unknown-frequency'],
    ['fixed rate without a coupon rate', { couponRate: null }, 'no-coupon-rate'],
    ['first coupon date off the schedule', { firstCouponDate: '2026-07-01' }, 'first-coupon-off-schedule'],
  ])('refuses: %s', (_label, patch, reason) => {
    expect(deriveBackwardFlows({ ...CS50, ...(patch as Partial<DerivationInput>) })).toEqual({ ok: false, reason })
  })
})

describe('mergeFlowHistory', () => {
  const TODAY = '2026-10-21'
  const h = (date: string, ren: number, lastSeenAsOf = date, amo = 0) => ({ date, ren, amo, firstSeenAsOf: '2026-01-01', lastSeenAsOf })
  const c = (date: string, ren: number, amo = 0) => ({ date, ren, amo })
  const base = { today: TODAY, inCatalog: true, derived: [] }

  it('past: history wins over on_cashflows; future: on_cashflows wins over history', () => {
    const out = mergeFlowHistory({ ...base, history: [h('2026-10-10', 2), h('2026-11-10', 9)], current: [c('2026-10-10', 7), c('2026-11-10', 3)] })
    expect(out).toEqual([
      { date: '2026-10-10', ren: 2, amo: 0, provenance: 'byma-history' },
      { date: '2026-11-10', ren: 3, amo: 0, provenance: 'byma' },
    ])
  })

  it('a future flow BYMA removed does not come back from history while the ISIN is in the catalog', () => {
    const out = mergeFlowHistory({ ...base, history: [h('2026-11-10', 1.5, '2026-10-20'), h('2027-05-10', 1.5, '2026-10-20')], current: [c('2027-05-10', 1.5)] })
    expect(out.map((f) => [f.date, f.provenance])).toEqual([['2027-05-10', 'byma']])
  })

  it('an ISIN absent from the catalog keeps its future history rows, flagged unconfirmed with a reason', () => {
    const out = mergeFlowHistory({ ...base, inCatalog: false, history: [h('2026-11-10', 1.5, '2026-10-20')], current: [] })
    expect(out).toEqual([{ date: '2026-11-10', ren: 1.5, amo: 0, provenance: 'byma-history-unconfirmed', reason: 'isin-not-in-catalog' }])
  })

  it('a past history row is confirmed when last seen within 5 business days before its date', () => {
    // 2026-09-10 is a Thursday: 5 business days before is Thu 2026-09-03; 6 is Wed 2026-09-02.
    const ok = mergeFlowHistory({ ...base, history: [h('2026-09-10', 3.6, '2026-09-03')], current: [] })
    expect(ok[0].provenance).toBe('byma-history')
    const late = mergeFlowHistory({ ...base, history: [h('2026-09-10', 3.6, '2026-09-02')], current: [] })
    expect(late[0]).toMatchObject({ provenance: 'byma-history-unconfirmed', reason: 'last-seen-2026-09-02-more-than-5-business-days-before' })
  })

  it('a past row last seen long before its date (removed future flow) is unconfirmed', () => {
    const out = mergeFlowHistory({ ...base, history: [h('2026-09-10', 3.6, '2026-06-01')], current: [] })
    expect(out[0].provenance).toBe('byma-history-unconfirmed')
  })

  it('a past row last seen on or after its date counts as confirmed', () => {
    expect(mergeFlowHistory({ ...base, history: [h('2026-09-10', 3.6, '2026-09-11')], current: [] })[0].provenance).toBe('byma-history')
  })

  it('a flow due today and already dropped from the payload is not resurrected (it becomes past tomorrow)', () => {
    expect(mergeFlowHistory({ ...base, history: [h('2026-10-21', 1.5, '2026-10-20')], current: [c('2027-04-21', 1.5)] }).map((f) => f.date)).toEqual(['2027-04-21'])
  })

  it('derived flows only fill past dates that history does not cover', () => {
    const derived = [
      { date: '2026-03-10', ren: 1.78, amo: 0, provenance: 'derived' as const },
      { date: '2026-09-10', ren: 5.44, amo: 0, provenance: 'derived' as const },
    ]
    const out = mergeFlowHistory({ ...base, history: [h('2026-09-10', 3.625, '2026-09-09')], current: [c('2027-03-10', 3.625)], derived })
    expect(out.map((f) => [f.date, f.ren, f.provenance])).toEqual([
      ['2026-03-10', 1.78, 'derived'],
      ['2026-09-10', 3.625, 'byma-history'],
      ['2027-03-10', 3.625, 'byma'],
    ])
  })

  it('output is sorted by date and does not mutate its inputs', () => {
    const history = Object.freeze([h('2026-09-01', 1)]) as ReturnType<typeof h>[]
    const current = Object.freeze([c('2027-01-01', 1), c('2026-12-01', 1)]) as ReturnType<typeof c>[]
    expect(mergeFlowHistory({ ...base, history, current }).map((f) => f.date)).toEqual(['2026-09-01', '2026-12-01', '2027-01-01'])
  })
})

describe('loadFlowRows', () => {
  const stub = (tables: Record<string, unknown[] | { message: string }>) => ({
    from: (t: string) => ({
      select: () => ({
        eq: () => ({
          order: () => {
            const v = tables[t]
            return Promise.resolve(Array.isArray(v) ? { data: v, error: null } : { data: null, error: v })
          },
        }),
      }),
    }),
  })

  it('reads both tables for one ISIN and maps numerics', async () => {
    const sb = stub({
      on_flow_history: [{ flow_date: '2026-10-10', ren: '1.500000', amo: '0.000000', first_seen_as_of: '2026-09-01', last_seen_as_of: '2026-10-09' }],
      on_cashflows: [{ flow_date: '2027-04-10', ren: '1.5', amo: '100' }],
    })
    await expect(loadFlowRows(sb as never, 'AR0394353335')).resolves.toEqual({
      history: [{ date: '2026-10-10', ren: 1.5, amo: 0, firstSeenAsOf: '2026-09-01', lastSeenAsOf: '2026-10-09' }],
      current: [{ date: '2027-04-10', ren: 1.5, amo: 100 }],
    })
  })

  it('throws on a read error instead of returning a partial schedule', async () => {
    const sb = stub({ on_flow_history: { message: 'boom' }, on_cashflows: [] })
    await expect(loadFlowRows(sb as never, 'X')).rejects.toThrow(/on_flow_history: boom/)
  })
})
