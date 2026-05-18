// ═══════════════════════════════════════════════════════════════════════════
// AUTHENTICATION & USER TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Authenticated user from Supabase Auth
 */
export interface User {
  id: string
  email: string
  email_confirmed_at?: string
  phone?: string
  phone_confirmed_at?: string
  app_metadata?: Record<string, any>
  user_metadata?: Record<string, any>
  aud?: string
  created_at: string
  updated_at: string
}

/**
 * Supabase session with auth tokens
 */
export interface AuthSession {
  access_token: string
  refresh_token?: string
  expires_in: number
  expires_at?: number
  token_type: string
  user: User
}

// ═══════════════════════════════════════════════════════════════════════════
// OPERATION & TRANSACTION TYPES
// ═══════════════════════════════════════════════════════════════════════════

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
  asset_type: AssetType
  moneda: Moneda
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
  version: number  // Optimistic locking
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
  // Global totals
  total_market_value: number
  total_invested: number
  open_pnl: number
  open_pnl_pct: number
  day_pnl: number
  day_pnl_pct: number
  realized_pnl: number
  realized_pnl_pct: number
  
  // Breakdown by asset class
  stocks: {
    market_value: number
    invested: number
    pnl: number
    pnl_pct: number
    day_pnl: number
    day_pnl_pct: number
    positions_count: number
  }
  ons: {
    market_value: number
    invested: number
    pnl: number
    pnl_pct: number
    day_pnl: number
    day_pnl_pct: number
    positions_count: number
  }
  cash: {
    balance: number
  }
  
  // Legacy fields (keep for backward compatibility)
  positions_count: number
  best_performer: Position | null
  worst_performer: Position | null
}

export type AssetType = 'ACCION' | 'CEDEAR' | 'ON'
export type Moneda = 'ARS' | 'USD'

export interface TransactionInput {
  date: string
  ticker: string
  operation: Operation
  quantity: number
  price: number
  commission?: number
  notes?: string
  assetType?: AssetType
  moneda?: Moneda
}

export interface Activo {
  ticker: string
  nombre: string
}

export interface Cedear extends Activo {
  ratio: number
  activo: boolean
}

// ═══════════════════════════════════════════════════════════════════════════
// ON (OBLIGACIONES NEGOCIABLES) TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ONOperation = 'COMPRA' | 'VENTA' | 'CUPON'

export interface ONPosition {
  id: string
  user_id: string
  ticker: string
  quantity: number
  avg_cost: number
  total_invested: number
  first_bought: string | null
  last_updated: string
  version: number  // Optimistic locking
  // enriched fields (calculated at runtime)
  current_price?: number
  market_value?: number
  pnl?: number
  pnl_pct?: number
  day_change?: number
  day_change_pct?: number
}

export interface ONClosedTrade {
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

// ═══════════════════════════════════════════════════════════════════════════
// CASH TRACKING TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type CashMovementType = 'DEPOSITO' | 'RETIRO' | 'CUPON' | 'DIVIDENDO'

export interface CashBalance {
  id: string
  user_id: string
  balance: number
  updated_at: string
  version: number  // Optimistic locking
}

export interface CashMovement {
  id: string
  user_id: string
  date: string
  type: CashMovementType
  amount: number
  description: string | null
  ticker: string | null
  transaction_id: string | null  // Links to transactions.id
  created_at: string
}

export interface CashMovementInput {
  date: string
  type: CashMovementType
  amount: number
  description?: string
  ticker?: string
  transaction_id?: string  // Links to transactions.id (for COMPRA/VENTA), null for manual/CUPON/DIVIDENDO
}

// ═══════════════════════════════════════════════════════════════════════════
// API RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Standard paginated API response wrapper
 */
export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

/**
 * Standard error response from API
 */
export interface ErrorResponse {
  error: string
  details?: string
  status?: number
}

/**
 * Standard success response wrapper
 */
export interface SuccessResponse<T> {
  success: true
  data: T
  timestamp?: string
}

/**
 * Processing result from transaction operations
 */
export interface ProcessTransactionResult {
  position: Position | null
  closed_trade: ClosedTrade | null
  metadata: {
    operation: Operation
    quantity: number
    price: number
    avg_cost_after: number
  }
}

/**
 * Portfolio calculation result
 */
export interface CalculatedPortfolio {
  summary: PortfolioSummary
  positions: Position[]
  closed_trades: ClosedTrade[]
  transactions: Transaction[]
  lastUpdated: string
}

/**
 * Import operation metadata and progress
 */
export interface ImportOperation {
  id: string
  user_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  total_rows: number
  processed_rows: number
  successful_rows: number
  failed_rows: number
  errors: Array<{ row: number; message: string }>
  created_at: string
  completed_at?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION & REQUEST TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Query parameters for list endpoints
 */
export interface ListQueryParams {
  page?: number
  limit?: number
  ticker?: string
  sort_by?: string
  sort_order?: 'asc' | 'desc'
}

/**
 * Date range filter
 */
export interface DateRange {
  start_date: string
  end_date: string
}

/**
 * Filter options for portfolio queries
 */
export interface PortfolioFilters extends DateRange {
  asset_types?: AssetType[]
  status?: 'open' | 'closed'
}

// ═══════════════════════════════════════════════════════════════════════════
// STRATEGY & INDICATOR TYPES (Sprint 3)
// ═══════════════════════════════════════════════════════════════════════════

export type IndicatorType = 'EMA' | 'RSI' | 'MACD' | 'Bollinger' | 'Volume'

export type IndicatorOperator =
  | 'crosses_above'
  | 'crosses_below'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'

export interface IndicatorParam {
  type: IndicatorType
  period?: number
  source?: string
  fast?: number
  slow?: number
  signal?: number
  stdDev?: number
}

export interface ConditionRule {
  indicator: IndicatorType
  period?: number
  operator: IndicatorOperator
  target?: IndicatorType
  targetPeriod?: number
  value?: number
}

export interface SetupConfig {
  indicators: IndicatorParam[]
  conditions: {
    buy: ConditionRule[]
    sell: ConditionRule[]
  }
  stopLoss?: number
  takeProfit?: number
}

export interface Strategy {
  id: string
  user_id: string
  name: string
  philosophy: string
  tickers: string[]
  timeframes: string[]
  active: boolean
  created_at: string
}

export interface IndicatorSetup {
  id: string
  strategy_id: string
  user_id: string
  name: string
  config: SetupConfig
  active: boolean
  created_at: string
}

export interface Signal {
  id: string
  setup_id: string
  strategy_id: string
  user_id: string
  ticker: string
  type: 'BUY' | 'SELL'
  price: number
  timeframe: string
  fired_at: string
  metadata?: Record<string, unknown>
}

export interface PaperTrade {
  id: string
  setup_id: string
  strategy_id: string
  user_id: string
  ticker: string
  open_signal_id?: string
  close_signal_id?: string
  open_price: number
  close_price?: number
  open_at: string
  close_at?: string
  close_reason?: 'SIGNAL' | 'STOP_LOSS' | 'TAKE_PROFIT'
  pnl_pct?: number
  status: 'OPEN' | 'CLOSED'
}

export interface SetupPerformance {
  id: string
  setup_id: string
  strategy_id: string
  user_id: string
  ticker: string
  total_trades: number
  profitable_trades: number
  hit_rate?: number
  avg_return_pct?: number
  avg_duration_days?: number
  updated_at: string
}

export interface Alert {
  id: string
  user_id: string
  ticker: string
  setup_id?: string
  channels: string[]
  active: boolean
  last_fired_at?: string
  created_at: string
}

export interface WatchlistItem {
  id: string
  user_id: string
  ticker: string
  notes?: string
  added_at: string
}

export interface StrategyWithSetups extends Strategy {
  indicator_setups: IndicatorSetup[]
}

export interface StrategiesListResponse {
  strategies: StrategyWithSetups[]
}
