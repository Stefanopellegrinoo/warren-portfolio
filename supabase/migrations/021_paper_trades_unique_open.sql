-- Prevent multiple OPEN paper trades for the same setup+ticker combination
-- This is the DB-level idempotency guard for the signals worker
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS paper_trades_open_unique
  ON paper_trades (setup_id, ticker)
  WHERE status = 'OPEN';
