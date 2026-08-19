-- supabase/migrations/033_snapshot_source.sql
-- Distinguishes a measured snapshot from a reconstructed one.
--
-- The historical backfill replays transactions against split-adjusted Yahoo
-- closes. That is a good estimate, not an observation: positions with no
-- historical price are marked at cost, and ONs always are (Data912 is
-- spot-only). Rows written by the daily job are observations. Anything that
-- later needs only measured data filters on source = 'live'.
--
-- Existing rows predate the backfill and are all observations.

alter table portfolio_snapshots
  add column if not exists source text not null default 'live';

alter table portfolio_snapshots
  drop constraint if exists portfolio_snapshots_source_check;

alter table portfolio_snapshots
  add constraint portfolio_snapshots_source_check
  check (source in ('live', 'estimated'));

comment on column portfolio_snapshots.source is
  'live = written by the daily snapshot job from real quotes; estimated = reconstructed by the historical backfill (scripts/backfill-snapshots.ts)';

create index if not exists idx_portfolio_snapshots_user_source
  on portfolio_snapshots(user_id, source);
