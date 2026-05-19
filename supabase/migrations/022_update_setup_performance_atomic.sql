-- Atomic upsert for setup_performance to prevent lost updates on concurrent paper-trade closes.
-- Two simultaneous closes for the same (setup_id, ticker) previously performed a read-compute-write
-- in JS, which caused one of the updates to be silently lost. This function uses INSERT ... ON CONFLICT
-- DO UPDATE with arithmetic computed entirely in SQL, which is atomic per row.

CREATE OR REPLACE FUNCTION update_setup_performance_atomic(
  p_setup_id        UUID,
  p_strategy_id     UUID,
  p_user_id         UUID,
  p_ticker          TEXT,
  p_pnl_pct         NUMERIC,
  p_duration_days   NUMERIC
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO setup_performance (
    setup_id, strategy_id, user_id, ticker,
    total_trades, profitable_trades, hit_rate,
    avg_return_pct, avg_duration_days, updated_at
  ) VALUES (
    p_setup_id, p_strategy_id, p_user_id, p_ticker,
    1,
    CASE WHEN p_pnl_pct > 0 THEN 1 ELSE 0 END,
    CASE WHEN p_pnl_pct > 0 THEN 1.0 ELSE 0.0 END,
    p_pnl_pct,
    p_duration_days,
    now()
  )
  ON CONFLICT (setup_id, ticker) DO UPDATE SET
    total_trades      = setup_performance.total_trades + 1,
    profitable_trades = setup_performance.profitable_trades
                        + CASE WHEN p_pnl_pct > 0 THEN 1 ELSE 0 END,
    hit_rate          = (setup_performance.profitable_trades
                          + CASE WHEN p_pnl_pct > 0 THEN 1 ELSE 0 END)::NUMERIC
                        / (setup_performance.total_trades + 1),
    avg_return_pct    = (COALESCE(setup_performance.avg_return_pct, 0)
                          * setup_performance.total_trades + p_pnl_pct)
                        / (setup_performance.total_trades + 1),
    avg_duration_days = (COALESCE(setup_performance.avg_duration_days, 0)
                          * setup_performance.total_trades + p_duration_days)
                        / (setup_performance.total_trades + 1),
    updated_at        = now();
END $$;
