CREATE TABLE IF NOT EXISTS watchlist (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol     text        NOT NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT watchlist_user_symbol_unique UNIQUE (user_id, symbol)
);

CREATE INDEX IF NOT EXISTS watchlist_user_id_idx ON watchlist(user_id);

ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "watchlist_select" ON watchlist
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "watchlist_insert" ON watchlist
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "watchlist_delete" ON watchlist
  FOR DELETE USING (auth.uid() = user_id);
