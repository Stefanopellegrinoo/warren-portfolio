import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/lib/redis', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/lib/redis')>()),
  ensureRedisConnected: vi.fn(async () => false),
  getRedis: vi.fn(() => null),
}))
vi.mock('../../src/lib/yahoo-finance', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/lib/yahoo-finance')>()),
  fetchQuotes: vi.fn(async () => new Map()),
}))

import {
  parseArgs, runCompare, buildCompareDeps, EXIT_DEGRADED, EXIT_GATE_FAILED, EXIT_PASS, type CompareDeps,
} from '../compare-derived-vs-snapshots'
import { getDerivedSeries } from '../../src/lib/derived-series'
import { fetchSnapshotSeries } from '../../src/lib/snapshot-series'
import { computeLiveSnapshotRow } from '../../src/lib/portfolio-snapshots'
import * as redis from '../../src/lib/redis'
import type { DerivedRow } from '../../src/lib/derive-history'
import type { PortfolioSnapshot } from '../../src/types'

const TODAY = '2026-03-20'
const DATES = ['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-16']
const FLAGS = { negativeCash: null, costMarkedStocks: [], vanished: [], onAggregateMarkDates: [], todayUnpriced: [], failure: null }

const row = (date: string, over: Partial<DerivedRow> = {}): DerivedRow => ({
  user_id: 'u1', snapshot_date: date, total_value: 1000, total_invested: 900, pnl: 100, pnl_pct: 0.11,
  stocks_value: 600, stocks_invested: 500, ons_value: 100, ons_invested: 100, cash_value: 300, source: 'live', ...over,
})
const snap = (date: string): PortfolioSnapshot => ({ ...row(date), id: date, source: 'live' })

function deps(over: Partial<CompareDeps> = {}) {
  let t = 0
  const lines: string[] = []
  const calls: string[] = []
  const d: CompareDeps = {
    today: TODAY,
    derive: vi.fn(async () => {
      calls.push('derive')
      return { rows: [...DATES.map(x => row(x)), row(TODAY, { total_value: 1010 })], degraded: false, flags: FLAGS, knownAt: () => null }
    }),
    readSnapshots: vi.fn(async () => DATES.map(snap)),
    liveTotal: vi.fn(async () => { calls.push('liveTotal'); return 1010 }),
    onPriceDates: vi.fn(async () => DATES),
    now: () => (t += 1500),
    log: (l: string) => { lines.push(l) },
    ...over,
  }
  return { d, lines, calls }
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
  it('exits 0 when the gate passes, prints timings and per-check compared counts', async () => {
    const { d, lines } = deps()
    expect(await runCompare(d)).toBe(EXIT_PASS)
    const out = lines.join('\n')
    expect(out).toMatch(/cold/i)
    expect(out).toMatch(/warm/i)
    expect(out).toContain('G1')
    expect(out).toContain('6 dates compared')
    expect(out).toContain('corrupt snapshots: none')
    expect(d.derive).toHaveBeenCalledTimes(2)
  })

  it('S3: reads the live total right after the first derive, before the second', async () => {
    const { d, calls } = deps()
    await runCompare(d)
    expect(calls).toEqual(['derive', 'liveTotal', 'derive'])
  })

  it('exits 1 when a gate fails, and lists the unexplained date', async () => {
    const { d, lines } = deps({
      derive: vi.fn(async () => ({
        rows: [...DATES.map(x => row(x, x === '2026-03-10' ? { stocks_value: 650 } : {})), row(TODAY, { total_value: 1010 })],
        degraded: false, flags: FLAGS, knownAt: () => null,
      })),
    })
    expect(await runCompare(d)).toBe(EXIT_GATE_FAILED)
    expect(lines.join('\n')).toMatch(/2026-03-10.*UNEXPLAINED/)
  })

  it('S2: a degraded derive exits 3, distinct from a gate failure', async () => {
    const { d, lines } = deps({
      derive: vi.fn(async () => ({ rows: [row(TODAY)], degraded: true, flags: FLAGS, knownAt: () => null })),
    })
    expect(await runCompare(d)).toBe(EXIT_DEGRADED)
    expect(EXIT_DEGRADED).not.toBe(EXIT_GATE_FAILED)
    expect(lines.join('\n')).toMatch(/degraded/i)
  })

  it('W4: ON aggregate-mark dates are excluded from G4 and listed', async () => {
    const { d, lines } = deps({
      derive: vi.fn(async () => ({
        rows: [...DATES.map(x => row(x)), row(TODAY, { total_value: 1010 })], degraded: false,
        flags: { ...FLAGS, onAggregateMarkDates: DATES.slice(0, 2) }, knownAt: () => null,
      })),
    })
    expect(await runCompare(d)).toBe(EXIT_GATE_FAILED) // 6 dates - 2 marked = 4 < 5
    expect(lines.join('\n')).toContain('2026-03-09, 2026-03-10')
  })
})

// --- W5: the real wiring against a fake database that cannot be written to -----------------

const TX = { ticker: 'AAA', operation: 'COMPRA', quantity: 10, price: 50, commission: 0, date: '2026-03-02', asset_type: 'ACCION', created_at: '2026-03-02T15:00:00Z' }
const MOVES = [{ type: 'DEPOSITO', amount: 5000, date: '2026-03-01', created_at: '2026-03-01T12:00:00Z' }]
const DB: Record<string, any[]> = { transactions: [TX], cash_movements: MOVES, on_price_history: [{ price_date: '2026-03-04' }, { price_date: '2026-03-04' }, { price_date: '2026-03-05' }] }

function readOnlySupabase() {
  const ops: string[] = []
  const forbidden = (op: string) => () => { throw new Error(`WRITE ATTEMPT: ${op}`) }
  return {
    ops,
    client: {
      from(table: string) {
        let offset = 0
        const b: any = {
          select: (cols?: string) => { ops.push(`${table}.select(${cols ?? ''})`); return b },
          eq: (c: string, v: unknown) => { ops.push(`${table}.eq(${c},${v})`); return b },
          in: () => b, gte: () => b, lte: () => b, order: () => b,
          range: (o: number) => { offset = o; return b },
          insert: forbidden(`${table}.insert`), update: forbidden(`${table}.update`),
          upsert: forbidden(`${table}.upsert`), delete: forbidden(`${table}.delete`),
          then: (res: any, rej: any) => Promise.resolve({ data: (DB[table] ?? []).slice(offset, offset + 1000), error: null }).then(res, rej),
        }
        return b
      },
      rpc: forbidden('rpc'),
    } as any,
  }
}

describe('buildCompareDeps (the real wiring)', () => {
  it('only reads, scopes by user, and sends bars through the memory-only cache', async () => {
    const { client, ops } = readOnlySupabase()
    const getBars = vi.fn(async (symbols: string[], _from: Date, _o?: { memoryOnly?: boolean }) =>
      new Map(symbols.map(s => [s, {
        bars: [{ date: '2026-03-03', close: 60 }, { date: '2026-03-04', close: 61 }, { date: '2026-03-05', close: 62 }],
        splits: [], splitsKnown: true, degraded: false, missing: false,
      }])))
    const d = buildCompareDeps(client, 'u1', TODAY, {
      getDerivedSeries, getBars: getBars as any, fetchSnapshotSeries, computeLiveSnapshotRow,
      derivedDeps: { today: TODAY, getHistoricalCCL: async () => new Map(), fetchQuotes: async () => new Map([['AAA', { ticker: 'AAA', price: 70, change: 0, changePercent: 0, previousClose: 70 }]]) },
    })

    const derived = await d.derive()
    await d.readSnapshots()
    await d.liveTotal()
    const priceDates = await d.onPriceDates()

    expect(derived.degraded).toBe(false)
    expect(priceDates.sort()).toEqual(['2026-03-04', '2026-03-05'])
    expect(getBars).toHaveBeenCalled()
    expect(getBars.mock.calls.every(c => c[2]?.memoryOnly === true)).toBe(true)
    expect(redis.ensureRedisConnected).not.toHaveBeenCalled()
    expect(redis.getRedis).not.toHaveBeenCalled()

    // every query is a select, and the tables are exactly the ones the gate needs
    expect(new Set(ops.map(o => o.split('.')[0]))).toEqual(new Set([
      'transactions', 'cash_movements', 'ticker_identity', 'portfolio_snapshots', 'on_price_history',
      'positions', 'on_positions', 'closed_trades', 'on_closed_trades', 'cash_balance',
    ]))
    expect(ops).toContain('transactions.eq(user_id,u1)')
    expect(ops).toContain('cash_movements.eq(user_id,u1)')
    expect(ops).toContain('portfolio_snapshots.eq(user_id,u1)')
    expect(ops).toContain('on_price_history.select(price_date)')
  })

  it('the fake really blows up on writes (so a passing run proves there were none)', () => {
    const { client } = readOnlySupabase()
    expect(() => client.from('transactions').insert({})).toThrow(/WRITE ATTEMPT/)
    expect(() => client.rpc('x')).toThrow(/WRITE ATTEMPT/)
  })
})
