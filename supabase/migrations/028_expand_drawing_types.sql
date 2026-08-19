-- Migration 028: Expand chart_drawings type CHECK constraint to include
-- hline, ray, channel, price_range in addition to trendline and fibonacci.
-- Uses dynamic pg_constraint lookup so it works regardless of the
-- auto-generated constraint name in the target database.

DO $$
DECLARE
  con_name text;
BEGIN
  -- Strict match: only constraints that begin with CHECK ((type IN (...)
  -- The space-tolerant POSIX regex prevents matching future check constraints
  -- on different columns that happen to mention "type" and "IN".
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.chart_drawings'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ~ 'CHECK \(\(?type IN \('
  LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.chart_drawings DROP CONSTRAINT %I', con_name);
  END IF;

  ALTER TABLE public.chart_drawings
    ADD CONSTRAINT chart_drawings_type_check
    CHECK (type IN ('trendline', 'fibonacci', 'hline', 'ray', 'channel', 'price_range'));
END $$;
