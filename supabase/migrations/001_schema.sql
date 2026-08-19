-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────
-- TRANSACTIONS
-- Core table. Every buy/sell/dividend lives here.
-- avg_cost_after is computed server-side (running weighted avg).
-- ─────────────────────────────────────────────
create table transactions (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  date          date not null,
  ticker        text not null,
  operation     text not null check (operation in ('COMPRA','VENTA','DIVIDENDO')),
  quantity      numeric(18,6) not null,  -- positive=buy, negative=sell
  price         numeric(18,4) not null,
  commission    numeric(18,4) not null default 0,
  total         numeric(18,4) generated always as (quantity * price + commission) stored,
  avg_cost_after numeric(18,4),           -- set by server after insert
  notes         text,
  created_at    timestamptz default now()
);

-- ─────────────────────────────────────────────
-- POSITIONS (materialized view updated by trigger)
-- Stores current open positions with correct running avg cost
-- ─────────────────────────────────────────────
create table positions (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  ticker        text not null,
  quantity      numeric(18,6) not null default 0,
  avg_cost      numeric(18,4) not null default 0,   -- weighted running avg
  total_invested numeric(18,4) not null default 0,  -- qty * avg_cost
  first_bought  date,
  last_updated  timestamptz default now(),
  unique(user_id, ticker)
);

-- ─────────────────────────────────────────────
-- CLOSED TRADES
-- Written when a position fully closes (qty → 0)
-- ─────────────────────────────────────────────
create table closed_trades (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  ticker        text not null,
  open_date     date not null,
  close_date    date not null,
  days_held     int generated always as (close_date - open_date) stored,
  avg_cost      numeric(18,4) not null,
  close_price   numeric(18,4) not null,
  quantity      numeric(18,6) not null,
  invested      numeric(18,4) not null,
  proceeds      numeric(18,4) not null,
  pnl           numeric(18,4) generated always as (proceeds - invested) stored,
  pnl_pct       numeric(10,6) generated always as ((proceeds - invested) / nullif(invested,0)) stored,
  created_at    timestamptz default now()
);

-- ─────────────────────────────────────────────
-- CASH FLOW
-- ─────────────────────────────────────────────
create table cashflow (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  date          date not null,
  category      text not null,
  description   text,
  amount_usd    numeric(18,4) not null,
  status        text not null default 'PENDIENTE' check (status in ('PAGADO','PENDIENTE')),
  created_at    timestamptz default now()
);

-- ─────────────────────────────────────────────
-- PORTFOLIO SNAPSHOTS (for evolution chart)
-- Stored daily by a cron job / manual trigger
-- ─────────────────────────────────────────────
create table portfolio_snapshots (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  snapshot_date date not null,
  total_value   numeric(18,4) not null,
  total_invested numeric(18,4) not null,
  pnl           numeric(18,4) not null,
  pnl_pct       numeric(10,6) not null,
  unique(user_id, snapshot_date)
);

-- ─────────────────────────────────────────────
-- RLS POLICIES
-- ─────────────────────────────────────────────
alter table transactions       enable row level security;
alter table positions          enable row level security;
alter table closed_trades      enable row level security;
alter table cashflow           enable row level security;
alter table portfolio_snapshots enable row level security;

-- Each user sees only their own data
create policy "own_transactions"        on transactions        for all using (auth.uid() = user_id);
create policy "own_positions"           on positions           for all using (auth.uid() = user_id);
create policy "own_closed_trades"       on closed_trades       for all using (auth.uid() = user_id);
create policy "own_cashflow"            on cashflow            for all using (auth.uid() = user_id);
create policy "own_portfolio_snapshots" on portfolio_snapshots for all using (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
create index idx_transactions_user_ticker on transactions(user_id, ticker);
create index idx_transactions_user_date   on transactions(user_id, date);
create index idx_positions_user           on positions(user_id);
create index idx_closed_trades_user       on closed_trades(user_id);
create index idx_cashflow_user_date       on cashflow(user_id, date);
create index idx_snapshots_user_date      on portfolio_snapshots(user_id, snapshot_date);
