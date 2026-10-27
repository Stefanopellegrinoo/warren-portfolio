# Supabase efficiency: fit the app in the free Nano instance
Branch `perf/supabase-efficiency` (from `master` d680798). Delivery: ask-on-risk; forecast ≈ 350 authored lines → single PR unless it grows. Runner: vitest (`npm test`, `npm run type-check`).

## Specs

- S1 (goal): "no voy a pagar mas plata. Primero hay que hacer la app mas eficiente, cuidar mas los recursos, usarlos mas inteligentemente, hasta si hace falta usar menos servicios de los que nos da suipabase." → with nobody using the app, Supabase API requests fall from ~1,556/h (measured 2026-10-26 19:00–20:00 UTC, market open) to ≤ 100/h with the market open and ≤ 60/h closed, at no extra cost. Prices, price alerts (crypto included) and summaries keep updating every minute as today.
- S2 (worker ledgers): the worker's per-minute cycle rereads the ledgers (transactions, cash movements, ON payment overrides) only after something was written, on a new day, or after a maximum age; otherwise it reuses what it has.
- S3 (worker market data): data that changes once a day (ON terms, cashflows, flow history, CCL history) is read by the worker at most once per day, plus after a write that changes which instruments are held.
- S4 (alerts): active price alerts are reread only when an alert is created, edited, deleted or triggered, or after a maximum age; crypto alerts are still checked every minute.
- S5 (auth outage storm): when Supabase does not answer, a page request makes at most one session refresh attempt (measured 2026-10-27 11:46–11:48 UTC: 7,845 `POST /auth/v1/token` from the Next.js middleware in 2 minutes).
- S6 (measure): after deploy, Supabase requests per hour are measured again from the edge logs (same query as the baseline) and recorded here, with the dashboard's memory and Disk IO.

Assumptions: Redis (already used) is the shared signal between the web app and the worker; a stale read is bounded by the maximum age (S2, S4). Lowering Postgres `shared_buffers` (CLI-only, restart, Owner/Admin login) is a candidate, measured before proposing it: the database is 20 MB but `shared_buffers` is 224 MB.

## Tasks

- T1 S2,S3 — worker reuses ledgers and daily market data between cycles, guarded by a version bumped on every write — inline — pending
- T2 S4 — worker reuses active alerts between cycles, guarded by an alerts version — inline — pending
- T3 S5 — middleware session refresh without a retry storm — inline — pending
- T4 S1,S6 — deploy, measure again, record before/after — inline — pending

## Log

- L1 (2026-10-27) "che me parece que hay un error, no me carga la app" → Supabase crawling from 06:59 UTC (trivial queries 10+ s, statement timeouts, every API request 5xx); no deploy or job at that time; status page all operational. The user restarted the project at 11:48 UTC and it recovered. Dashboard at 06:50 UTC: RAM 411 MB, swap 348 MB (84.66 %), memory commitment 1.3 GB of 1.4 GB (warning), CPU 94 % idle.
- L2 (2026-10-27) "pero porque le queda chico? Es rarisimo, siempre uso supabase para mis proyectos y nunca pasa esto" → measured: DB 20 MB, 25 idle connections, `shared_buffers` 224 MB; pg_stat_statements over 227 days ≈ 1–2 requests/min on average. The difference with idle hobby projects: a 24/7 worker querying every minute.
- L3 (2026-10-27) "no voy a pagar mas plata. Primero hay que hacer la app mas eficiente, cuidar mas los recursos, usarlos mas inteligentemente, hasta si hace falta usar menos servicios de los que nos da suipabase." Baseline (edge logs, 2026-10-26 12:00 → 2026-10-27 12:00 UTC, restart window excluded): market-open hours ~1,550–2,100 requests/h even with no user (19:00 UTC: transactions 358, on_payment_overrides 357, price_alerts 120, fx_rates 119, on_terms 120); market closed ~60/h (price_alerts once a minute). The per-minute worker job (`price-worker.ts`, `PRICE_REPEAT_JOB_NAME`) loads every ledger twice per cycle (`getAllTickers` → `loadAllLedgers`; `cacheUserSummaries` → `loadUserPortfolios` → `loadAllLedgers` + `loadSchedules`).
