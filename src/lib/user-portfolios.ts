import { createServiceClient } from './supabase-server'

/** Everything calculatePortfolioSummary needs for a single user. */
export interface UserPortfolioInputs {
  userId: string
  positions: any[]
  onPositions: any[]
  realized: number
  onRealized: number
  cashBalance: number
}

/**
 * Loads the portfolio inputs for every user that has stock positions, ON
 * positions, or a non-zero cash balance.
 *
 * Shared by the summary cache and the daily snapshot job so both see exactly
 * the same universe of users — a user missing here is a user whose numbers
 * silently stop updating.
 */
export async function loadUserPortfolios(): Promise<UserPortfolioInputs[]> {
  const supabase = createServiceClient()

  const [stockRes, onRes, closedRes, onClosedRes, cashRes] = await Promise.all([
    supabase.from('positions').select('*'),
    supabase.from('on_positions').select('*'),
    supabase.from('closed_trades').select('user_id, pnl'),
    supabase.from('on_closed_trades').select('user_id, pnl'),
    supabase.from('cash_balance').select('user_id, balance'),
  ])

  const userStocks = new Map<string, any[]>()
  ;(stockRes.data ?? []).forEach((p: any) => {
    const list = userStocks.get(p.user_id) || []
    list.push(p)
    userStocks.set(p.user_id, list)
  })

  const userONs = new Map<string, any[]>()
  ;(onRes.data ?? []).forEach((p: any) => {
    const list = userONs.get(p.user_id) || []
    list.push(p)
    userONs.set(p.user_id, list)
  })

  const userRealized = new Map<string, number>()
  ;(closedRes.data ?? []).forEach((t: any) => {
    userRealized.set(t.user_id, (userRealized.get(t.user_id) || 0) + (t.pnl || 0))
  })

  const userONRealized = new Map<string, number>()
  ;(onClosedRes.data ?? []).forEach((t: any) => {
    userONRealized.set(t.user_id, (userONRealized.get(t.user_id) || 0) + (t.pnl || 0))
  })

  const userCash = new Map<string, number>()
  ;(cashRes.data ?? []).forEach((b: any) => {
    userCash.set(b.user_id, b.balance || 0)
  })

  // Cash-only users count too — a balance with no positions is still a portfolio
  const userIds = Array.from(
    new Set([
      ...Array.from(userStocks.keys()),
      ...Array.from(userONs.keys()),
      ...Array.from(userCash.entries())
        .filter(([, balance]) => balance !== 0)
        .map(([userId]) => userId),
    ])
  )

  return userIds.map(userId => ({
    userId,
    positions: userStocks.get(userId) || [],
    onPositions: userONs.get(userId) || [],
    realized: userRealized.get(userId) || 0,
    onRealized: userONRealized.get(userId) || 0,
    cashBalance: userCash.get(userId) || 0,
  }))
}
