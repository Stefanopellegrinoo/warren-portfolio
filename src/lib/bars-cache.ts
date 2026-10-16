// src/lib/bars-cache.ts
/**
 * Daily Yahoo charts, cached one key per Yahoo symbol: `bars:v1:{symbol}`.
 *
 * An entry is FRESH when it was fetched today (Argentine day) and covers the
 * requested window; otherwise the whole window is refetched, which is also how
 * a split's retroactive re-adjustment gets picked up. The entry lives 7 days so
 * that, when Yahoo is down, the last known bars can still be served — flagged
 * degraded, never silently. Redis down -> a module-level Map.
 *
 * Redis runs noeviction: EVERY write goes through setex.
 */
import { ensureRedisConnected, getRedis } from './redis'
import { fetchDailyChart, type DailyBar, type DailyChart, type SplitEvent } from './historical-prices'
import { argentinaDate } from './utils'

export const BARS_TTL = 7 * 86400
const CONCURRENCY = 5

interface Entry {
  fetchedOn: string
  /** First day the fetched window covers. */
  from: string
  bars: [string, number][]
  splits: [string, number, number][]
  splitsKnown: boolean
}

export interface BarsResult {
  bars: DailyBar[]
  splits: SplitEvent[]
  splitsKnown: boolean
  /** Stale entry served, or nothing available. */
  degraded: boolean
  /** No data at all (Yahoo failed and nothing stored). */
  missing: boolean
}

export interface BarsDeps {
  fetchChart?: (symbol: string, from: Date, to: Date) => Promise<DailyChart>
  today?: string
}

const memory = new Map<string, Entry>()
export const _resetBarsMemory = () => memory.clear()

const keyOf = (symbol: string) => `bars:v1:${symbol}`

async function readEntry(symbol: string): Promise<Entry | null> {
  try {
    if (await ensureRedisConnected()) {
      const raw = await getRedis()?.get(keyOf(symbol))
      if (raw) return JSON.parse(raw) as Entry
      return null
    }
  } catch {
    // Redis misbehaving is the same as Redis down.
  }
  return memory.get(symbol) ?? null
}

async function writeEntry(symbol: string, entry: Entry): Promise<void> {
  try {
    if (await ensureRedisConnected()) {
      await getRedis()?.setex(keyOf(symbol), BARS_TTL, JSON.stringify(entry))
      return
    }
  } catch {
    // fall through to memory
  }
  memory.set(symbol, entry)
}

const toResult = (e: Entry, degraded: boolean): BarsResult => ({
  bars: e.bars.map(([date, close]) => ({ date, close })),
  splits: e.splits.map(([date, numerator, denominator]) => ({ date, numerator, denominator })),
  splitsKnown: e.splitsKnown,
  degraded,
  missing: false,
})

async function getOne(symbol: string, from: Date, deps: BarsDeps): Promise<BarsResult> {
  const today = deps.today ?? argentinaDate()
  const fromDay = from.toISOString().slice(0, 10)
  const stored = await readEntry(symbol)
  if (stored && stored.fetchedOn === today && stored.from <= fromDay) return toResult(stored, false)

  try {
    const chart = await (deps.fetchChart ?? fetchDailyChart)(symbol, from, new Date(`${today}T23:59:59Z`))
    const entry: Entry = {
      fetchedOn: today,
      from: fromDay,
      bars: chart.bars.map(b => [b.date, b.close]),
      splits: chart.splits.map(s => [s.date, s.numerator, s.denominator]),
      splitsKnown: chart.splitsKnown,
    }
    await writeEntry(symbol, entry)
    return toResult(entry, false)
  } catch (err) {
    console.warn(`[Bars] Yahoo failed for ${symbol}:`, err instanceof Error ? err.message : err)
    if (stored) return toResult(stored, true)
    return { bars: [], splits: [], splitsKnown: false, degraded: true, missing: true }
  }
}

/** Bars + splits per Yahoo symbol, at most 5 symbols in flight. Never throws. */
export async function getBars(
  symbols: string[],
  from: Date,
  deps: BarsDeps = {}
): Promise<Map<string, BarsResult>> {
  const queue = Array.from(new Set(symbols))
  const out = new Map<string, BarsResult>()
  const worker = async () => {
    for (let s = queue.shift(); s !== undefined; s = queue.shift()) {
      out.set(s, await getOne(s, from, deps))
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
  return out
}
