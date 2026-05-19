DROP TABLE IF EXISTS watchlist;

CREATE TABLE watchlists (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE watchlist_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  watchlist_id uuid NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  added_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT watchlist_items_unique UNIQUE (watchlist_id, symbol)
);

CREATE INDEX watchlist_items_watchlist_id_idx ON watchlist_items(watchlist_id);

ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wl_select" ON watchlists FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "wl_insert" ON watchlists FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "wl_update" ON watchlists FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "wl_delete" ON watchlists FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE watchlist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wli_select" ON watchlist_items FOR SELECT USING (
  watchlist_id IN (SELECT id FROM watchlists WHERE user_id = auth.uid())
);
CREATE POLICY "wli_insert" ON watchlist_items FOR INSERT WITH CHECK (
  watchlist_id IN (SELECT id FROM watchlists WHERE user_id = auth.uid())
);
CREATE POLICY "wli_delete" ON watchlist_items FOR DELETE USING (
  watchlist_id IN (SELECT id FROM watchlists WHERE user_id = auth.uid())
);
