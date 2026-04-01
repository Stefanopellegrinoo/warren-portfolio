-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 003: Multi-Asset Support (ONs + Cash Tracking)
-- ═══════════════════════════════════════════════════════════════════════════
-- ADDITIVE ONLY — NO breaking changes. Existing stock data remains untouched.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- ON POSITIONS (Obligaciones Negociables)
-- Tracks open ON positions with running avg cost
-- ─────────────────────────────────────────────
create table on_positions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  ticker text not null,
  quantity numeric(18,6) not null default 0,
  avg_cost numeric(18,4) not null default 0,
  total_invested numeric(18,4) not null default 0,
  first_bought date,
  last_updated timestamptz default now(),
  unique(user_id, ticker)
);

-- ─────────────────────────────────────────────
-- ON CLOSED TRADES
-- Records fully closed ON positions with P&L
-- ─────────────────────────────────────────────
create table on_closed_trades (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  ticker text not null,
  open_date date not null,
  close_date date not null,
  days_held int generated always as (close_date - open_date) stored,
  avg_cost numeric(18,4) not null,
  close_price numeric(18,4) not null,
  quantity numeric(18,6) not null,
  invested numeric(18,4) not null,
  proceeds numeric(18,4) not null,
  pnl numeric(18,4) generated always as (proceeds - invested) stored,
  pnl_pct numeric(10,6) generated always as ((proceeds - invested) / nullif(invested,0)) stored,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────
-- CASH BALANCE
-- Single row per user tracking current cash
-- ─────────────────────────────────────────────
create table cash_balance (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  balance numeric(18,4) not null default 0,
  updated_at timestamptz default now(),
  unique(user_id)
);

-- ─────────────────────────────────────────────
-- CASH MOVEMENTS
-- Deposits, withdrawals, coupons, dividends
-- ─────────────────────────────────────────────
create table cash_movements (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  type text not null check (type in ('DEPOSITO','RETIRO','CUPON','DIVIDENDO')),
  amount numeric(18,4) not null,
  description text,
  ticker text,  -- for CUPON/DIVIDENDO tracking (e.g., "AL30")
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────
-- RLS POLICIES
-- Users can only access their own data
-- ─────────────────────────────────────────────
alter table on_positions enable row level security;
alter table on_closed_trades enable row level security;
alter table cash_balance enable row level security;
alter table cash_movements enable row level security;

create policy "own_on_positions" on on_positions for all using (auth.uid() = user_id);
create policy "own_on_closed_trades" on on_closed_trades for all using (auth.uid() = user_id);
create policy "own_cash_balance" on cash_balance for all using (auth.uid() = user_id);
create policy "own_cash_movements" on cash_movements for all using (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- INDEXES
-- Performance optimization for queries
-- ─────────────────────────────────────────────
create index idx_on_positions_user on on_positions(user_id);
create index idx_on_closed_trades_user on on_closed_trades(user_id);
create index idx_cash_balance_user on cash_balance(user_id);
create index idx_cash_movements_user_date on cash_movements(user_id, date);
create index idx_cash_movements_ticker on cash_movements(user_id, ticker) where ticker is not null;
