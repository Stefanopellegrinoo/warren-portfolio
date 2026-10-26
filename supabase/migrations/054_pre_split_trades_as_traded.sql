-- Migration 054: the account's pre-split trades stored as traded (odd/tasks/split-aware-ledger.md T6, S3).
--
-- WHY
-- Since 053 a trade is stored as traded and every computation applies the splits after
-- it. Nine trades of account 54745d6e were loaded split-adjusted (for example GOOGL
-- bought 2022-03-21 at 136.98, when it traded near 2,700), so the splits would now be
-- applied twice. They are brought back to the quantity and price of that day: quantity
-- divided by the split factor, price multiplied by it. quantity × price, the cash
-- movements and every other row are unchanged.
--
--   GOOGL 20:1 2022-07-18   2 buys 2022-03-21
--   TSLA   3:1 2022-08-25   buy 2022-03-02, sale 2022-03-31
--   NVDA  10:1 2024-06-10   2 buys 2022-05-05, sales 2023-06-29 and 2023-08-02
--   SONY   5:1 2024-10-09   buy 2023-09-01
--
-- TSLA 9.8 / 3 is stored as 3.266667 (6 decimals): the buy and its sale round alike and
-- still close; the cost moves by less than 0.001 USD.
--
-- SAFETY: the nine rows are copied to backup.transactions_20261026 first, in the same
-- transaction. Each row is updated only while it still holds its split-adjusted price,
-- and a partial conversion (1 to 8 rows) aborts the whole migration; a second run fails
-- on the existing backup and changes nothing. A database without this account (a local
-- reset, CI) converts none: a NOTICE, not an error.
-- Rollback: UPDATE public.transactions t SET quantity = b.quantity, price = b.price,
--   trade_quantity = b.trade_quantity, trade_price = b.trade_price
--   FROM backup.transactions_20261026 b WHERE t.id = b.id;

BEGIN;

CREATE SCHEMA IF NOT EXISTS backup;

CREATE TABLE backup.transactions_20261026 AS
SELECT * FROM public.transactions
WHERE user_id = '54745d6e-3c1f-49b3-b46d-78d4016e8c20'
  AND id IN (
    'f19c5e46-fd83-40e1-a4e7-d27475e0a407', 'cf1e568d-bfc3-4595-ba55-5b2ba8fa8d32',
    '673c1416-e757-44c6-aec0-02565b8e6959', '0a14f6b9-8172-4c7c-85e3-7c7295037549',
    '577e1107-aec3-46b3-881c-d3c2e069dd41', '8aa9f5c5-77cf-4e6f-9993-24a92dfcf43d',
    'ae0e6ef7-0b06-438d-b0d1-e0299d351a6b', '5354d55d-8776-4ee9-bc94-25b8f7659e00',
    '18fc462b-50d2-4bdb-b261-5ee5433fd29e'
  );

DO $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.transactions t
  SET quantity = t.quantity / f.factor,
      price = t.price * f.factor,
      trade_quantity = t.trade_quantity / f.factor,
      trade_price = t.trade_price * f.factor
  FROM (VALUES
    ('f19c5e46-fd83-40e1-a4e7-d27475e0a407'::uuid, 20::numeric, 129.58::numeric),
    ('cf1e568d-bfc3-4595-ba55-5b2ba8fa8d32'::uuid, 20, 136.98),
    ('673c1416-e757-44c6-aec0-02565b8e6959'::uuid, 3, 290.4),
    ('0a14f6b9-8172-4c7c-85e3-7c7295037549'::uuid, 3, 360),
    ('577e1107-aec3-46b3-881c-d3c2e069dd41'::uuid, 10, 18.9),
    ('8aa9f5c5-77cf-4e6f-9993-24a92dfcf43d'::uuid, 10, 18.9),
    ('ae0e6ef7-0b06-438d-b0d1-e0299d351a6b'::uuid, 10, 41),
    ('5354d55d-8776-4ee9-bc94-25b8f7659e00'::uuid, 10, 44.6),
    ('18fc462b-50d2-4bdb-b261-5ee5433fd29e'::uuid, 5, 17)
  ) AS f(id, factor, adjusted_price)
  WHERE t.id = f.id
    AND t.user_id = '54745d6e-3c1f-49b3-b46d-78d4016e8c20'
    AND t.price = f.adjusted_price;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE NOTICE '054: none of the nine rows to convert here, nothing changed';
  ELSIF v_updated <> 9 THEN
    RAISE EXCEPTION '054: expected to convert 9 rows, converted %: nothing was changed', v_updated;
  END IF;
END $$;

COMMIT;
