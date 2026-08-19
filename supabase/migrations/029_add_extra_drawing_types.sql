-- Migration 029: Add horizontal_ray and arrow to chart_drawings type CHECK constraint.

DO $$
DECLARE
  con_name text;
BEGIN
  -- Find the existing check constraint on chart_drawings for the 'type' column
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
    CHECK (type IN (
      'trendline', 
      'fibonacci', 
      'hline', 
      'ray', 
      'channel', 
      'price_range',
      'horizontal_ray',
      'arrow'
    ));
END $$;
