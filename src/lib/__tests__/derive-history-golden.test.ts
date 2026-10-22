// src/lib/__tests__/derive-history-golden.test.ts
/**
 * REQ-4 golden equality: the derived series must reproduce the stored
 * snapshots. Fixture = read-only extract of one real account (ledger, snapshot
 * values, Yahoo closes), so this is a regression net against the real ledger.
 * The $1 tolerance is the spec's — never widen it, explain the diff instead.
 */
import { describe, it, expect } from 'vitest'
import fixture from './fixtures/derive-golden.json'
import { deriveHistory } from '../derive-history'
import type { DailyBar } from '../historical-prices'

const MONEY_SCALE = 3 * 1.75 // quantity factor x price factor used to anonymize the fixture
const TOLERANCE = 1 * MONEY_SCALE // spec's $1, in fixture units
const TODAY = '2026-05-15' // the (shifted) day the fixture was cut; today's row is not compared

const derived = deriveHistory({
  userId: 'golden',
  transactions: fixture.transactions as any[],
  movements: fixture.movements as any[],
  barsByTicker: new Map(Object.entries(fixture.bars as Record<string, DailyBar[]>)),
  onPricesByTicker: new Map(),
  schedules: new Map(),
  overrides: [],
  today: TODAY,
  todayQuotes: new Map(),
})
const rowsByDate = new Map(derived.rows.map(r => [r.snapshot_date, r]))
const estimated = fixture.snapshots.filter(s => s.source === 'estimated')

describe('derived history vs stored snapshots (anonymized real account)', () => {
  it('derived without failure', () => {
    expect(derived.flags.failure).toBeNull()
  })

  it('S4.1 stocks_value + cash_value match on all 71 estimated dates within $1', () => {
    expect(estimated).toHaveLength(71)
    const offenders = estimated
      .map(s => {
        const r = rowsByDate.get(s.date)
        const diff = r ? r.stocks_value + r.cash_value - (s.stocks_value + s.cash_value) : NaN
        return { date: s.date, diff }
      })
      .filter(o => !(Math.abs(o.diff) <= TOLERANCE))
    expect(offenders).toEqual([])
  })

  it('S4.2 has a row for every market day between the first and the last snapshot, with no gaps', () => {
    const dates = derived.rows.map(r => r.snapshot_date)
    expect(new Set(dates).size).toBe(dates.length)
    expect(dates).toEqual([...dates].sort())
    for (const s of fixture.snapshots) {
      if (s.date >= '2025-11-07' && s.date < TODAY) expect(rowsByDate.has(s.date), s.date).toBe(true)
    }
  })
})
