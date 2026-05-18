begin;

create table strategies (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  philosophy  text not null,
  tickers     text[] default '{}',
  timeframes  text[] default '{}',
  active      boolean default true,
  created_at  timestamptz default now()
);

-- N indicator setups per strategy; cascade-delete when strategy is removed
create table indicator_setups (
  id           uuid primary key default uuid_generate_v4(),
  strategy_id  uuid not null references strategies(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  config       jsonb not null default '{}',
  active       boolean default true,
  created_at   timestamptz default now()
);

create table signals (
  id           uuid primary key default uuid_generate_v4(),
  setup_id     uuid not null references indicator_setups(id) on delete cascade,
  strategy_id  uuid not null references strategies(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  ticker       text not null,
  type         text not null check (type in ('BUY', 'SELL')),
  price        numeric not null,
  timeframe    text not null,
  fired_at     timestamptz not null default now(),
  metadata     jsonb
);

create table paper_trades (
  id              uuid primary key default uuid_generate_v4(),
  setup_id        uuid not null references indicator_setups(id) on delete cascade,
  strategy_id     uuid not null references strategies(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  ticker          text not null,
  open_signal_id  uuid references signals(id),
  close_signal_id uuid references signals(id),
  open_price      numeric not null,
  close_price     numeric,
  open_at         timestamptz not null default now(),
  close_at        timestamptz,
  close_reason    text check (close_reason in ('SIGNAL', 'STOP_LOSS', 'TAKE_PROFIT')),
  pnl_pct         numeric,
  status          text not null default 'OPEN' check (status in ('OPEN', 'CLOSED'))
);

create table setup_performance (
  id                 uuid primary key default uuid_generate_v4(),
  setup_id           uuid not null references indicator_setups(id) on delete cascade,
  strategy_id        uuid not null references strategies(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  ticker             text not null,
  total_trades       integer default 0,
  profitable_trades  integer default 0,
  hit_rate           numeric,
  avg_return_pct     numeric,
  avg_duration_days  numeric,
  updated_at         timestamptz default now(),
  unique(setup_id, ticker)
);

create table alerts (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  ticker        text not null,
  setup_id      uuid references indicator_setups(id),
  channels      text[] not null default '{telegram}',
  active        boolean default true,
  last_fired_at timestamptz,
  created_at    timestamptz default now()
);

create table watchlist (
  id       uuid primary key default uuid_generate_v4(),
  user_id  uuid not null references auth.users(id) on delete cascade,
  ticker   text not null,
  notes    text,
  added_at timestamptz default now(),
  unique(user_id, ticker)
);

-- ─────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────
alter table strategies        enable row level security;
alter table indicator_setups  enable row level security;
alter table signals           enable row level security;
alter table paper_trades      enable row level security;
alter table setup_performance enable row level security;
alter table alerts            enable row level security;
alter table watchlist         enable row level security;

create policy "own_strategies"        on strategies        for all using (auth.uid() = user_id);
create policy "own_indicator_setups"  on indicator_setups  for all using (auth.uid() = user_id);
create policy "own_signals"           on signals           for all using (auth.uid() = user_id);
create policy "own_paper_trades"      on paper_trades      for all using (auth.uid() = user_id);
create policy "own_setup_performance" on setup_performance for all using (auth.uid() = user_id);
create policy "own_alerts"            on alerts            for all using (auth.uid() = user_id);
create policy "own_watchlist"         on watchlist         for all using (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
create index idx_strategies_user_id         on strategies(user_id);

create index idx_indicator_setups_strategy  on indicator_setups(strategy_id);
create index idx_indicator_setups_user      on indicator_setups(user_id);

create index idx_signals_setup_id           on signals(setup_id);
create index idx_signals_user_id            on signals(user_id);
create index idx_signals_fired_at           on signals(fired_at);

create index idx_paper_trades_setup_id      on paper_trades(setup_id);
create index idx_paper_trades_status        on paper_trades(status);
create index idx_paper_trades_user          on paper_trades(user_id);
create index idx_paper_trades_open_at       on paper_trades(open_at);

create index idx_setup_performance_setup    on setup_performance(setup_id);
create index idx_setup_performance_ticker   on setup_performance(ticker);

create index idx_alerts_user                on alerts(user_id);

create index idx_watchlist_user_id          on watchlist(user_id);

commit;
