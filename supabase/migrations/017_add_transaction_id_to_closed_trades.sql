-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 017: Add transaction_id to closed_trades for traceability and upserts
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.closed_trades ADD COLUMN transaction_id UUID REFERENCES public.transactions(id) ON DELETE CASCADE;
ALTER TABLE public.on_closed_trades ADD COLUMN transaction_id UUID REFERENCES public.transactions(id) ON DELETE CASCADE;

-- Create unique constraint to allow UPSERTs
ALTER TABLE public.closed_trades ADD CONSTRAINT closed_trades_transaction_id_key UNIQUE (transaction_id);
ALTER TABLE public.on_closed_trades ADD CONSTRAINT on_closed_trades_transaction_id_key UNIQUE (transaction_id);

-- Backfill transaction_id (best effort based on date, ticker and quantity)
-- Note: This might not be 100% accurate for past duplicate trades, but is necessary for the constraint.
-- If duplicates exist, we might need to handle them or accept some loss in historical mapping.
-- For new trades, it will be perfect.
