begin;

create table alert_history (
  id         uuid primary key default uuid_generate_v4(),
  alert_id   uuid not null references alerts(id) on delete cascade,
  signal_id  uuid references signals(id) on delete set null,
  channel    text not null check (channel in ('telegram', 'email')),
  status     text not null check (status in ('sent', 'failed')),
  error      text,
  sent_at    timestamptz not null default now()
);

alter table alert_history enable row level security;

-- RLS: user can read/insert history of their own alerts (derived through alert_id → alerts.user_id)
create policy "own_alert_history" on alert_history
  for all
  using (
    exists (
      select 1 from alerts
      where alerts.id = alert_history.alert_id
        and alerts.user_id = auth.uid()
    )
  );

create index idx_alert_history_alert  on alert_history(alert_id, sent_at desc);
create index idx_alert_history_signal on alert_history(signal_id);

commit;
