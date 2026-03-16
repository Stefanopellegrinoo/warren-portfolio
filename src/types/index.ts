export type Operation = 'COMPRA' | 'VENTA' | 'DIVIDENDO'
export type CashflowStatus = 'PAGADO' | 'PENDIENTE'

export interface Transaction {
  id: string
  user_id: string
  date: string
  ticker: string
  operation: Operation
  quantity: number
  price: number
  commission: number
  total: number
  avg_cost_after: number | null
  notes: string | null
  created_at: string
}

export interface Position {
  id: string
  user_id: string
  ticker: string
  quantity: number
  avg_cost: number
  total_invested: number
  first_bought: string | null
  last_updated: string
  // enriched client-side
  current_price?: number
  market_value?: number
  pnl?: number
  pnl_pct?: number
  day_change?: number
  day_change_pct?: number
}

export interface ClosedTrade {
  id: string
  user_id: string
  ticker: string
  open_date: string
  close_date: string
  days_held: number
  avg_cost: number
  close_price: number
  quantity: number
  invested: number
  proceeds: number
  pnl: number
  pnl_pct: number
  created_at: string
}

export interface Cashflow {
  id: string
  user_id: string
  date: string
  category: string
  description: string | null
  amount_usd: number
  status: CashflowStatus
  created_at: string
}

export interface PortfolioSnapshot {
  id: string
  user_id: string
  snapshot_date: string
  total_value: number
  total_invested: number
  pnl: number
  pnl_pct: number
}

export interface Quote {
  ticker: string
  price: number
  change: number
  changePercent: number
  previousClose: number
  updatedAt?: string
}

export interface PortfolioSummary {
  total_market_value: number
  total_invested: number
  open_pnl: number
  open_pnl_pct: number
  day_pnl: number
  day_pnl_pct: number
  realized_pnl: number
  realized_pnl_pct: number
  positions_count: number
  best_performer: Position | null
  worst_performer: Position | null
}

export interface TransactionInput {
  date: string
  ticker: string
  operation: Operation
  quantity: number
  price: number
  commission?: number
  notes?: string
}
