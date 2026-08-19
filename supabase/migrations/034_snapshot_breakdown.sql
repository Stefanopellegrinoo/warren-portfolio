-- supabase/migrations/034_snapshot_breakdown.sql
-- Per-asset-class breakdown on each snapshot row.
--
-- DEPLOY ORDERING — HARD PRECONDITION: apply this migration to the live DB
-- BEFORE building/deploying the image that writes these five columns. If the
-- image ships first, buildSnapshotRow emits columns the table does not have
-- yet, the writers' upsert fails with PGRST204, snapshotAllUsers swallows the
-- error per user and returns normally — so the nightly job silently reports
-- "0 written, N failed" and keeps running, looking healthy. Measured snapshot
-- history for those days is never written at all (no row — not a null row),
-- and the only recovery is the backfill, which marks ONs at cost, reintroducing
-- the exact distortion this migration exists to remove.
--
-- WHY: the three risk figures on /statistics are computed over a series in
-- which the ON holdings are a flat line for 71 of 75 days — the historical
-- backfill valued them at avg_cost because Data912 is spot-only. A slice that
-- does not move does not reduce risk, it reduces MEASURED risk. Without a
-- breakdown the app cannot compute a metric over the classes it can actually
-- measure, so it computes one over everything and reports it with confidence.
--
-- PortfolioSummary already carries these five numbers fully computed;
-- buildSnapshotRow received them and stored only the totals. This is what it
-- takes to stop discarding them.
--
-- NULLABLE ON PURPOSE: rows written before this migration have no breakdown.
-- Null reads as "not known". Zero would assert "this class was worth nothing"
-- — false, and it would poison every average computed downstream.

alter table portfolio_snapshots
  add column if not exists stocks_value    numeric(18,4),
  add column if not exists stocks_invested numeric(18,4),
  add column if not exists ons_value       numeric(18,4),
  add column if not exists ons_invested    numeric(18,4),
  add column if not exists cash_value      numeric(18,4);

comment on column portfolio_snapshots.stocks_value is
  'Market value of stock/CEDEAR positions on this date. Null = breakdown not known for this row.';
comment on column portfolio_snapshots.ons_value is
  'Market value of ON positions on this date. For reconstructed rows this equals cost: Data912 is spot-only and has no history.';
comment on column portfolio_snapshots.cash_value is
  'Cash balance on this date. total_value = stocks_value + ons_value + cash_value.';
comment on column portfolio_snapshots.stocks_invested is
  'Cost basis of stock/CEDEAR positions. stocks_invested + ons_invested = total_invested (cash is deliberately excluded from total_invested).';
