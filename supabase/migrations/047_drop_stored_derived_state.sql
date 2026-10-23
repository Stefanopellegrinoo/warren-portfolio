-- Migration 047: drop the stored derived state (odd/tasks/nucleo-ledger.md T5.2, S5).
--
-- Holdings, cost, realized P&L, cash and every day of the history are pure
-- functions of the ledger (transactions + cash_movements + on_payment_overrides)
-- and market data, computed on read by src/lib/ledger-core.ts. These six tables
-- only cached that computation; after 046 nothing writes them, and after the
-- branch's deploy nothing reads them.
--
-- RUN ORDER (dev and prod share one Supabase):
--   1. Deploy feat/ledger-core. master still reads these tables; run nothing before.
--   2. Apply 046 (write RPCs insert ledger rows only) AFTER the deploy.
--   3. The parent takes a backup of the six tables (e.g. CREATE TABLE ... AS / pg_dump)
--      and confirms it. Only AFTER that backup, and with the user's explicit OK,
--      apply this file. The drop is irreversible.
--
-- What goes with each table (Postgres drops it implicitly, no CASCADE needed):
-- its RLS policies (own_positions, own_closed_trades, own_portfolio_snapshots from 001;
-- own_on_positions, own_on_closed_trades, own_cash_balance from 003), its indexes
-- (005, 033) and its own constraints, including closed_trades.transaction_id's FK
-- to transactions (017). No migration defines a view, trigger or foreign key that
-- points AT these tables, and no live function references them after 046 (PL/pgSQL
-- bodies create no dependency). Without CASCADE, an unexpected dependent object in
-- the live database makes this fail and roll back instead of being dropped silently.

BEGIN;

DROP TABLE IF EXISTS public.portfolio_snapshots;
DROP TABLE IF EXISTS public.closed_trades;
DROP TABLE IF EXISTS public.on_closed_trades;
DROP TABLE IF EXISTS public.positions;
DROP TABLE IF EXISTS public.on_positions;
DROP TABLE IF EXISTS public.cash_balance;

COMMIT;
