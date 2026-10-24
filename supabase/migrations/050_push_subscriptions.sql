-- Migration 050: the devices that receive push notifications (odd/tasks/push-notificaciones.md S3).
--
-- One row per user and browser subscription (the installed app on a phone, a desktop browser).
-- The app saves and removes the signed-in user's rows; the price worker reads them with the
-- service role and deletes the ones the push service reports gone (404/410).
--
-- The server POSTs to `endpoint`, so the app accepts only known push services
-- (src/lib/push-endpoint.ts) and the sender checks again before every send: a row written
-- straight through the API with the user's own key is never trusted.

create table if not exists public.push_subscriptions (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  endpoint    text        not null check (endpoint like 'https://%' and length(endpoint) <= 2000),
  p256dh      text        not null,
  auth        text        not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

-- Single policy covers SELECT/INSERT/UPDATE/DELETE; WITH CHECK is mandatory
-- or the upsert will silently fail for the row's owner.
create policy "push_subscriptions_owner"
  on public.push_subscriptions
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger push_subscriptions_set_updated_at
  before update on public.push_subscriptions
  for each row execute function public.set_updated_at();
