import { valuePortfolio } from './portfolio-valuation'
import { portfoliosFrom, type UserPortfolioInputs } from './user-portfolios'
import { getRedis, SUMMARY_CACHE_TTL, takeDirtyUsers } from './redis'
import { createServiceClient } from './supabase-server'
import { currencyViewsFor, loadCurrencyContext, LEDGER_COLUMNS, tradeDateFx, type ViewsLedger } from './currency-views'
import type { CurrencyViews, LedgerTrade } from './multicurrency'
import { loadAllLedgers, loadLastCloses, loadLedger, onTickersOf, type UserLedger } from './ledger-now'
import type { FlowRow } from './on-flow-history'
import { loadSchedules } from './on-schedules'
import { MAX_AGE_MS } from './ledger-memo'
import { argentinaDate } from './utils'

/**
 * What the per-minute cycle needs that only a write changes (odd/tasks/supabase-efficiency.md S2-S3, S7):
 * every user's ledger (read with the currency views' columns), portfolio and views ledger with its
 * trade-date FX, and the ON schedules. Prices change every minute; these are read whole once, and after
 * that a write re-reads only the user who wrote (invalidateUserCache marks them in Redis), so what a write
 * costs does not grow with the number of users. Everyone is read again on a new day, after MAX_AGE_MS (a
 * write that skips the mark: a script, a half-failed write), after a failed re-read, and every cycle when
 * Redis cannot say who wrote, as before.
 */
interface CycleState {
  today: string
  at: number
  ledgers: Map<string, UserLedger>
  /** The ON tickers the schedules were read for. */
  onTickers: Set<string>
  schedules: Map<string, FlowRow[]>
  portfolios: Map<string, UserPortfolioInputs>
  views: Map<string, ViewsLedger>
}
let cycle: CycleState | null = null
let turn: Promise<unknown> = Promise.resolve()

/** One at a time: cycles that overlap never take the same marked users twice. */
export function loadCycleInputs(): Promise<{ ledgers: Map<string, UserLedger>; portfolios: UserPortfolioInputs[]; views: Map<string, ViewsLedger> }> {
  const next = turn.then(nextCycle, nextCycle)
  turn = next.catch(() => {})
  return next.then(s => ({ ledgers: s.ledgers, portfolios: [...s.portfolios.values()], views: s.views }))
}

/** Every ledger for the held tickers: if the cycle's read fails (an ON schedule, say), the ledgers alone, so prices never stop. */
export async function loadCycleLedgers(): Promise<Map<string, UserLedger>> {
  try {
    return (await loadCycleInputs()).ledgers
  } catch {
    return loadAllLedgers(createServiceClient(), LEDGER_COLUMNS)
  }
}

/** Tests: forget what the last cycles read. */
export function forgetCycleInputs() {
  cycle = null
}

async function nextCycle(): Promise<CycleState> {
  const today = argentinaDate()
  const written = await takeDirtyUsers()
  if (cycle && written !== null && cycle.today === today && Date.now() - cycle.at < MAX_AGE_MS) {
    if (written.length === 0) return cycle
    try {
      await reread(cycle, written)
      return cycle
    } catch (err) {
      cycle = null
      throw err
    }
  }
  cycle = null
  cycle = await readEveryone(today)
  return cycle
}

async function readEveryone(today: string): Promise<CycleState> {
  const sb = createServiceClient()
  const ledgers = await loadAllLedgers(sb, LEDGER_COLUMNS)
  const onTickers = new Set([...ledgers.values()].flatMap(l => onTickersOf(l.trades)))
  const schedules = await loadSchedules(sb, [...onTickers], today)
  const state: CycleState = { today, at: Date.now(), ledgers, onTickers, schedules, portfolios: new Map(), views: new Map() }
  await Promise.all([...ledgers.keys()].map(userId => rebuild(state, userId)))
  return state
}

/** The users who wrote: their ledger again and, for an ON nobody held before, the schedules. */
async function reread(state: CycleState, users: string[]) {
  const sb = createServiceClient()
  const fresh = await Promise.all(users.map(userId => loadLedger(sb, userId, LEDGER_COLUMNS)))
  users.forEach((userId, i) => {
    const l = fresh[i]
    if (l.trades.length || l.movements.length || l.overrides.length) state.ledgers.set(userId, l)
    else state.ledgers.delete(userId)
  })
  const added = users.flatMap(userId => onTickersOf(state.ledgers.get(userId)?.trades ?? [])).filter(t => !state.onTickers.has(t))
  if (added.length) {
    added.forEach(t => state.onTickers.add(t))
    state.schedules = await loadSchedules(sb, [...state.onTickers], state.today)
  }
  await Promise.all(users.map(userId => rebuild(state, userId)))
}

/** One user's portfolio and views ledger from what the state holds. */
async function rebuild(state: CycleState, userId: string) {
  const ledger = state.ledgers.get(userId)
  const [portfolio] = ledger ? portfoliosFrom(new Map([[userId, ledger]]), state.schedules, state.today) : []
  if (!ledger || !portfolio) {
    state.portfolios.delete(userId)
    state.views.delete(userId)
    return
  }
  state.portfolios.set(userId, portfolio)
  const trades = ledger.trades as unknown as LedgerTrade[]
  // An unreadable FX is read again by the views themselves, which fail alone, never the summary.
  const fxRows = await tradeDateFx(trades).catch(() => undefined)
  state.views.set(userId, { trades, overrides: ledger.overrides, schedules: state.schedules, splits: ledger.splits, fxRows })
}

/**
 * Lua compare-and-set used by cacheUserSummaries to avoid overwriting a summary
 * that was invalidated (version bumped) while the summary was being computed.
 *
 * KEYS[1]   summary:{userId}
 * KEYS[2]   summary:version:{userId}
 * ARGV[1]   startVersion (empty string means "no version key yet")
 * ARGV[2]   TTL in seconds
 * ARGV[3]   payload
 */
export const SUMMARY_SETEX_LUA = `
local key = KEYS[1]
local versionKey = KEYS[2]
local startVersion = ARGV[1]
local ttl = tonumber(ARGV[2])
local payload = ARGV[3]
local currentVersion = redis.call('GET', versionKey) or ''
if currentVersion == startVersion then
  redis.call('SETEX', key, ttl, payload)
  return 1
else
  return 0
end
`

/**
 * Atomically write a user summary only if the version counter still matches the
 * value observed at the start of the computation. Returns true when the write
 * succeeded, false when it was discarded because a mutation bumped the version.
 */
export async function setSummaryIfVersion(
  userId: string,
  payload: string,
  startVersion: string | null
): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false

  const version = startVersion ?? ''
  const result = await redis.eval(
    SUMMARY_SETEX_LUA,
    2,
    `summary:${userId}`,
    `summary:version:${userId}`,
    version,
    SUMMARY_CACHE_TTL,
    payload
  )

  if (result === 0 || result === '0') {
    console.log(`[Summary] Discarded stale summary write for ${userId} (version changed)`)
    return false
  }

  return true
}

/** The cached summary `summary:{userId}`, one format for the worker and /api/positions. */
export function summaryPayload(
  valued: Pick<ReturnType<typeof valuePortfolio>, 'positions' | 'onPositions' | 'summary' | 'unpricedCount' | 'unpricedTickers'>,
  currencies?: CurrencyViews
): string {
  const { positions, onPositions, summary, unpricedCount, unpricedTickers } = valued
  return JSON.stringify({ positions, onPositions, summary, unpricedCount, unpricedTickers, ...(currencies && { currencies }) })
}

/**
 * For every user with active positions or cash (from the ledger core), calculates
 * and caches their summary in Redis. This makes the Dashboard sub-10ms.
 *
 * stockQuotes: prices from Yahoo Finance
 * onQuotes: prices from Data912 (may be empty if Data912 not configured)
 */
export async function cacheUserSummaries(
  stockQuotes: Map<string, any>,
  onQuotes: Map<string, any> = new Map()
) {
  if (stockQuotes.size === 0 && onQuotes.size === 0) {
    console.log('[Worker] No prices available — skipping summary cache')
    return
  }

  console.log('[Worker] Caching user summaries...')

  const { portfolios, views } = await loadCycleInputs()

  const redis = getRedis()
  if (!redis) return

  // The Pesos / MEP / Cable views are an addition: failing to build them never
  // blocks the summary, which then keeps only the USD fields.
  const supabase = createServiceClient()
  const currencyCtx = await loadCurrencyContext(supabase).catch(err => {
    console.error('[Worker] currency views unavailable this cycle:', err)
    return null
  })

  for (const portfolio of portfolios) {
    const { userId } = portfolio
    const isImporting = await redis.get(`importing:${userId}`)
    if (isImporting) {
      console.log(`[Worker] Skipping summary cache for ${userId} — import in progress`)
      continue
    }

    // Read version at the start of the per-user computation
    const startVersion = await redis.get(`summary:version:${userId}`)

    const valued = valuePortfolio(
      {
        positions: portfolio.positions,
        onPositions: portfolio.onPositions,
        cashBalance: portfolio.cashBalance,
        realized: portfolio.realized,
        onRealized: portfolio.onRealized,
      },
      { stockQuotes, onQuotes },
      await loadLastCloses(supabase, portfolio.onPositions, onQuotes)
    )

    const currencies = currencyCtx
      ? await currencyViewsFor(supabase, userId, currencyCtx, { positions: valued.positions, onPositions: valued.onPositions, cashBalance: portfolio.cashBalance }, views.get(userId))
          .catch(err => { console.error(`[Worker] currency views failed for ${userId}:`, err); return undefined })
      : undefined

    await setSummaryIfVersion(userId, summaryPayload(valued, currencies), startVersion)
  }

  console.log(`[Worker] Cached summaries for ${portfolios.length} users (stocks + ONs + cash).`)
}
