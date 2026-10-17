import { describe, it, expect, vi } from 'vitest'
import { parseArgs, runCompare, type CompareDeps } from '../compare-derived-vs-snapshots'
import type { DerivedRow } from '../../src/lib/derive-history'
import type { PortfolioSnapshot } from '../../src/types'

const TODAY = '2026-03-20'
const DATES = ['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-16']
const FLAGS = { negativeCash: null, costMarkedStocks: [], vanished: [], onAggregateMarkDays: 2, todayUnpriced: [], failure: null }

const row = (date: string, over: Partial<DerivedRow> = {}): DerivedRow => ({
  user_id: 'u1', snapshot_date: date, total_value: 1000, total_invested: 900, pnl: 100, pnl_pct: 0.11,
  stocks_value: 600, stocks_invested: 500, ons_value: 100, ons_invested: 100, cash_value: 300, source: 'live', ...over,
})
const snap = (date: string): PortfolioSnapshot => ({ ...row(date), id: date, source: 'live' })

function deps(over: Partial<CompareDeps> = {}) {
  let t = 0
  const lines: string[] = []
  const d: CompareDeps = {
    today: TODAY,
    derive: vi.fn(async () => ({ rows: [...DATES.map(x => row(x)), row(TODAY, { total_value: 1010 })], degraded: false, flags: FLAGS, splits: [] })),
    readSnapshots: vi.fn(async () => DATES.map(snap)),
    readLedger: vi.fn(async () => ({ transactions: [], movements: [] })),
    liveTotal: vi.fn(async () => 1010),
    onFirstPriceDate: vi.fn(async () => '2026-03-09'),
    now: () => (t += 1500),
    log: (l: string) => { lines.push(l) },
    ...over,
  }
  return { d, lines }
}

describe('parseArgs', () => {
  it('requires --user <uid>', () => {
    expect(parseArgs(['--user', 'abc'])).toEqual({ userId: 'abc' })
    expect(parseArgs([])).toHaveProperty('error')
    expect(parseArgs(['--user'])).toHaveProperty('error')
    expect(parseArgs(['--user', '--other'])).toHaveProperty('error')
  })
})

describe('runCompare', () => {
  it('exits 0 when the gate passes and prints cold and warm timings', async () => {
    const { d, lines } = deps()
    expect(await runCompare(d)).toBe(0)
    const out = lines.join('\n')
    expect(out).toMatch(/cold/i)
    expect(out).toMatch(/warm/i)
    expect(out).toContain('G1')
    expect(out).toContain('onAggregateMarkDays')
    expect(d.derive).toHaveBeenCalledTimes(2)
  })

  it('exits 1 when a gate fails, and lists the unexplained date', async () => {
    const { d, lines } = deps({
      derive: vi.fn(async () => ({
        rows: [...DATES.map(x => row(x, x === '2026-03-10' ? { stocks_value: 650 } : {})), row(TODAY, { total_value: 1010 })],
        degraded: false, flags: FLAGS, splits: [],
      })),
    })
    expect(await runCompare(d)).toBe(1)
    expect(lines.join('\n')).toContain('2026-03-10')
  })

  it('exits 1 when the derived series is degraded: the comparison would not be trustworthy', async () => {
    const { d, lines } = deps({
      derive: vi.fn(async () => ({ rows: [row(TODAY)], degraded: true, flags: FLAGS, splits: [] })),
    })
    expect(await runCompare(d)).toBe(1)
    expect(lines.join('\n')).toMatch(/degraded/i)
  })

  it('never writes: only the injected readers are used', async () => {
    const { d } = deps()
    await runCompare(d)
    expect(Object.keys(d).sort()).toEqual(
      ['derive', 'liveTotal', 'log', 'now', 'onFirstPriceDate', 'readLedger', 'readSnapshots', 'today'].sort()
    )
  })
})
