-- Migration 040: saved ON test portfolios (hypothetical buy lists, never real holdings).
--
-- Per-user, owner-only: RLS in this same migration, user_id = auth.uid() on the
-- portfolio and, for items, ownership through the parent portfolio. No anon access
-- and no service_role policy: the API always uses the signed-in user's client.
--
-- Stored per item: ISIN, how the amount was typed (usd | vn), the amount and an
-- optional manual dirty price. Nothing derived (flows, yields) is persisted; the
-- analytics are recomputed per request from the public catalog.
--
-- Limits are enforced here and not only in the API (A6): 20 portfolios per user,
-- 50 items per portfolio. The BEFORE INSERT triggers take a transaction-scoped
-- advisory lock so two concurrent inserts cannot both pass the count.

-- ---------------------------------------------------------- test_portfolios
CREATE TABLE IF NOT EXISTS test_portfolios (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_test_portfolios_user_name ON test_portfolios (user_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_test_portfolios_user ON test_portfolios (user_id);

-- ----------------------------------------------------- test_portfolio_items
CREATE TABLE IF NOT EXISTS test_portfolio_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES test_portfolios(id) ON DELETE CASCADE,
  isin         TEXT NOT NULL CHECK (isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),
  input_mode   TEXT NOT NULL CHECK (input_mode IN ('usd', 'vn')),
  amount       NUMERIC(20,4) NOT NULL CHECK (amount > 0 AND amount <= 1e12),
  manual_price NUMERIC(14,6) CHECK (manual_price > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (portfolio_id, isin)
);

CREATE INDEX IF NOT EXISTS idx_test_portfolio_items_portfolio ON test_portfolio_items (portfolio_id);

COMMENT ON COLUMN test_portfolio_items.amount IS 'USD to invest or VN to buy, depending on input_mode';
COMMENT ON COLUMN test_portfolio_items.manual_price IS 'Dirty price per 100 VN that replaces the market price; NULL = market';

-- ------------------------------------------------------------------ limits
CREATE OR REPLACE FUNCTION enforce_test_portfolio_limit() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('test_portfolios:' || NEW.user_id::text));
  IF (SELECT count(*) FROM test_portfolios WHERE user_id = NEW.user_id) >= 20 THEN
    RAISE EXCEPTION 'test_portfolio_limit' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION enforce_test_portfolio_item_limit() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('test_portfolio_items:' || NEW.portfolio_id::text));
  IF (SELECT count(*) FROM test_portfolio_items WHERE portfolio_id = NEW.portfolio_id) >= 50 THEN
    RAISE EXCEPTION 'test_portfolio_item_limit' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Keeps the portfolio's updated_at honest when its items change (runs as the caller, so RLS applies).
CREATE OR REPLACE FUNCTION touch_test_portfolio() RETURNS TRIGGER AS $$
BEGIN
  UPDATE test_portfolios SET updated_at = NOW() WHERE id = COALESCE(NEW.portfolio_id, OLD.portfolio_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION set_test_portfolio_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Re-parenting would bypass the insert-time limits (move an item into a full portfolio, or a portfolio
-- into another user's quota); nothing legitimate needs it, so the parent keys are immutable.
CREATE OR REPLACE FUNCTION forbid_test_portfolio_item_reparent() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.portfolio_id IS DISTINCT FROM OLD.portfolio_id THEN
    RAISE EXCEPTION 'test_portfolio_immutable_parent' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION forbid_test_portfolio_owner_change() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'test_portfolio_immutable_parent' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_test_portfolio_item_immutable BEFORE UPDATE OF portfolio_id ON test_portfolio_items
  FOR EACH ROW EXECUTE FUNCTION forbid_test_portfolio_item_reparent();
CREATE TRIGGER trg_test_portfolio_immutable BEFORE UPDATE OF user_id ON test_portfolios
  FOR EACH ROW EXECUTE FUNCTION forbid_test_portfolio_owner_change();

CREATE TRIGGER trg_test_portfolio_limit BEFORE INSERT ON test_portfolios
  FOR EACH ROW EXECUTE FUNCTION enforce_test_portfolio_limit();
CREATE TRIGGER trg_test_portfolio_item_limit BEFORE INSERT ON test_portfolio_items
  FOR EACH ROW EXECUTE FUNCTION enforce_test_portfolio_item_limit();
CREATE TRIGGER trg_test_portfolio_touch AFTER INSERT OR UPDATE OR DELETE ON test_portfolio_items
  FOR EACH ROW EXECUTE FUNCTION touch_test_portfolio();
CREATE TRIGGER trg_test_portfolio_updated_at BEFORE UPDATE ON test_portfolios
  FOR EACH ROW EXECUTE FUNCTION set_test_portfolio_updated_at();

-- --------------------------------------------------------------------- RLS
ALTER TABLE test_portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_portfolio_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON test_portfolios FROM anon;
REVOKE ALL ON test_portfolio_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON test_portfolios TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON test_portfolio_items TO authenticated;

CREATE POLICY test_portfolios_select ON test_portfolios FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY test_portfolios_insert ON test_portfolios FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY test_portfolios_update ON test_portfolios FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY test_portfolios_delete ON test_portfolios FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY test_portfolio_items_select ON test_portfolio_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM test_portfolios p WHERE p.id = portfolio_id AND p.user_id = (SELECT auth.uid())));
CREATE POLICY test_portfolio_items_insert ON test_portfolio_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM test_portfolios p WHERE p.id = portfolio_id AND p.user_id = (SELECT auth.uid())));
CREATE POLICY test_portfolio_items_update ON test_portfolio_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM test_portfolios p WHERE p.id = portfolio_id AND p.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM test_portfolios p WHERE p.id = portfolio_id AND p.user_id = (SELECT auth.uid())));
CREATE POLICY test_portfolio_items_delete ON test_portfolio_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM test_portfolios p WHERE p.id = portfolio_id AND p.user_id = (SELECT auth.uid())));

-- ======================================================== ROLLBACK (manual)
-- Run only by hand, after exporting the rows you want to keep.
-- DROP TABLE IF EXISTS test_portfolio_items;
-- DROP TABLE IF EXISTS test_portfolios;
-- DROP FUNCTION IF EXISTS forbid_test_portfolio_owner_change();
-- DROP FUNCTION IF EXISTS forbid_test_portfolio_item_reparent();
-- DROP FUNCTION IF EXISTS set_test_portfolio_updated_at();
-- DROP FUNCTION IF EXISTS touch_test_portfolio();
-- DROP FUNCTION IF EXISTS enforce_test_portfolio_item_limit();
-- DROP FUNCTION IF EXISTS enforce_test_portfolio_limit();
