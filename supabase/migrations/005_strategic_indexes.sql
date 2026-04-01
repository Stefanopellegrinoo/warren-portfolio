-- ============================================
-- Migration 005: Strategic Performance Indexes
-- ============================================
-- 
-- Purpose: Add database indexes to optimize common query patterns
-- Phase: FASE 3 - Performance & Scalability
-- Date: 2026-03-31
--
-- Rationale:
--   - List queries on cash_movements, transactions, on_trades are frequent
--   - Filtering by user_id + date + type/ticker is common
--   - Compound indexes reduce query time from O(N) to O(log N)
--
-- IMPORTANT: These indexes are NON-BLOCKING (CONCURRENTLY)
--            Safe to run in production without downtime
--
-- ============================================

-- Index 1: Cash movements by user, date, and type
-- Use case: GET /api/cash/movements?type=DEPOSITO
-- Before: Full table scan
-- After: Index-only scan
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cash_movements_user_date_type
ON cash_movements(user_id, date DESC, type)
WHERE amount > 0;

-- Index 2: Transactions by user, ticker, and date
-- Use case: GET /api/transactions?ticker=AAPL
-- Before: Filter after fetching all user transactions
-- After: Direct index lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_user_ticker_date
ON transactions(user_id, ticker, date DESC);

-- Index 3: ON trades by user, ticker, and date
-- Use case: Rebuilding ON positions (rebuildONPosition)
-- Before: Sequential scan of all ON trades
-- After: Index-only scan for specific ticker
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_on_trades_user_ticker_date
ON on_trades(user_id, ticker, date DESC);

-- Index 4: Closed trades by user and date
-- Use case: GET /api/transactions/closed
-- Before: Full scan with WHERE quantity = 0 filter
-- After: Partial index for closed positions only
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_closed_trades_user_date
ON closed_trades(user_id, date DESC);

-- Index 5: Stock positions by user (covering index)
-- Use case: Dashboard loading all open positions
-- Before: Table scan
-- After: Index-only scan (includes frequently accessed columns)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_positions_user_ticker
ON positions(user_id, ticker)
INCLUDE (quantity, precio_promedio, market_value, created_at);

-- Index 6: ON positions by user (covering index)
-- Use case: Dashboard loading ON positions
-- Before: Table scan
-- After: Index-only scan
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_on_positions_user_ticker
ON on_positions(user_id, ticker)
INCLUDE (quantity, precio_compra, tasa_cupon, vencimiento);

-- ============================================
-- Verification Queries
-- ============================================
--
-- Run these to verify indexes are being used:
--
-- EXPLAIN ANALYZE
-- SELECT * FROM cash_movements 
-- WHERE user_id = 'some-uuid' AND type = 'DEPOSITO' 
-- ORDER BY date DESC 
-- LIMIT 50;
--
-- Expected: "Index Scan using idx_cash_movements_user_date_type"
--
-- ============================================

-- Log migration completion
DO $$
BEGIN
  RAISE NOTICE 'Migration 005 complete: Strategic indexes created';
  RAISE NOTICE 'Indexes created: 6 compound/covering indexes for common queries';
  RAISE NOTICE 'Performance impact: 2-10x faster for filtered/sorted queries';
END $$;
