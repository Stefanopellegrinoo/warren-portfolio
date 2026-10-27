import type { ONPosition, Position } from '@/types'
import { createServiceClient } from './supabase-server'
import { loadAllLedgers, ledgerNowFrom, onTickersOf, toPositions, type UserLedger } from './ledger-now'
import type { FlowRow } from './on-flow-history'
import { loadSchedules } from './on-schedules'
import { argentinaDate } from './utils'

/** Everything calculatePortfolioSummary needs for a single user. */
export interface UserPortfolioInputs {
  userId: string
  positions: Position[]
  onPositions: ONPosition[]
  realized: number
  onRealized: number
  cashBalance: number
}

/**
 * The portfolio inputs of every user with stock positions, ON positions, or a
 * non-zero cash balance, from the ledger core (odd/tasks/nucleo-ledger.md T4.2b).
 *
 * Shared by the summary cache and the daily snapshot job so both see exactly
 * the same universe of users — a user missing here is a user whose numbers
 * silently stop updating. A failed ledger read throws: caching a summary built
 * from half a ledger would serve wrong numbers until the next refresh.
 */
export async function loadUserPortfolios(today: string = argentinaDate()): Promise<UserPortfolioInputs[]> {
  const supabase = createServiceClient()
  const ledgers = await loadAllLedgers(supabase)
  return portfoliosFrom(ledgers, await loadAllSchedules(ledgers, today), today)
}

/** The ON schedules of every ON any of these ledgers ever traded. */
export function loadAllSchedules(ledgers: Map<string, UserLedger>, today: string): Promise<Map<string, FlowRow[]>> {
  return loadSchedules(createServiceClient(), [...ledgers.values()].flatMap(l => onTickersOf(l.trades)), today)
}

/** Pure: loadUserPortfolios from ledgers and schedules already read (the worker reuses them, ledger-memo.ts). */
export function portfoliosFrom(ledgers: Map<string, UserLedger>, schedules: Map<string, FlowRow[]>, today: string): UserPortfolioInputs[] {
  const out: UserPortfolioInputs[] = []
  ledgers.forEach((ledger, userId) => {
    const state = ledgerNowFrom(ledger, schedules, today)
    // Cash-only users count too — a balance with no positions is still a portfolio
    if (state.holdings.length === 0 && state.cash === 0) return
    const realized = (kind: 'ON' | 'STOCK') =>
      state.realized.filter(r => r.assetType === kind).reduce((sum, r) => sum + r.pnl, 0)
    out.push({
      userId,
      positions: toPositions(userId, state.holdings, 'STOCK'),
      onPositions: toPositions(userId, state.holdings, 'ON'),
      realized: realized('STOCK'),
      onRealized: realized('ON'),
      cashBalance: state.cash,
    })
  })
  return out
}
