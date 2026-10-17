import { describe, it, expect } from 'vitest'
import { explainDiff, MISPRICED_TICKERS } from '../derive-history'
import type { ReplayMovement, ReplayTransaction } from '../portfolio-replay'

const tx = (over: Partial<ReplayTransaction> = {}): ReplayTransaction => ({
  ticker: 'ZZZ', operation: 'COMPRA', quantity: 1, price: 10, commission: 0,
  date: '2026-03-02', asset_type: 'ACCION', created_at: '2026-03-02T15:00:00Z', ...over,
})
const mv = (over: Partial<ReplayMovement> = {}): ReplayMovement => ({
  type: 'DEPOSITO', amount: 100, date: '2026-03-02', created_at: '2026-03-02T15:00:00Z', ...over,
})

describe('explainDiff', () => {
  it('returns null when nothing explains the difference', () => {
    expect(explainDiff('2026-03-05', [tx()], [mv()], [])).toBeNull()
  })

  it('late-loaded: a tx dated <= D inserted after the 02:00Z snapshot of D+1', () => {
    const late = tx({ date: '2026-03-05', created_at: '2026-03-06T02:00:01Z' })
    expect(explainDiff('2026-03-05', [late], [], [])).toBe('late-loaded')
    const onTime = tx({ date: '2026-03-05', created_at: '2026-03-06T01:59:59Z' })
    expect(explainDiff('2026-03-05', [onTime], [], [])).toBeNull()
  })

  it('late-loaded also covers cash movements', () => {
    const late = mv({ date: '2026-03-04', created_at: '2026-03-09T12:00:00Z' })
    expect(explainDiff('2026-03-05', [tx()], [late], [])).toBe('late-loaded')
  })

  it('date-shift: dated D+1 but entered the evening of D (Argentina), so the snapshot of D saw it', () => {
    const evening = tx({ date: '2026-03-06', created_at: '2026-03-06T00:30:00Z' })
    expect(explainDiff('2026-03-05', [evening], [], [])).toBe('date-shift')
    // entered the previous day: not captured by D's snapshot as a same-evening entry
    const earlier = tx({ date: '2026-03-06', created_at: '2026-03-04T12:00:00Z' })
    expect(explainDiff('2026-03-05', [earlier], [], [])).toBeNull()
  })

  it('split: a held ticker splits after D', () => {
    const splits = [{ ticker: 'ZZZ', date: '2026-03-10' }]
    expect(explainDiff('2026-03-05', [tx()], [], splits)).toBe('split')
    expect(explainDiff('2026-03-10', [tx()], [], splits)).toBeNull()
    expect(explainDiff('2026-03-05', [tx({ ticker: 'OTHER' })], [], splits)).toBeNull()
  })

  it('misprice: a held ticker from the known list, only from its transaction date on', () => {
    const t = tx({ ticker: MISPRICED_TICKERS[0].toLowerCase(), date: '2026-03-04' })
    expect(explainDiff('2026-03-05', [t], [], [])).toBe('misprice')
    expect(explainDiff('2026-03-03', [t], [], [])).toBeNull()
  })
})
