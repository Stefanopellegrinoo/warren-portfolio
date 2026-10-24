# Performance: the whole app fast

Objective: every screen loads and switches fast from the iPhone in Argentina; first the Gráficos section (measured), then every other page (audit pending).
Branch `feat/performance` from `feat/chart-mobile` 2d38b00 (both unmerged; same chart files). Delivery: stacked after `feat/chart-mobile`. Tests: vitest (`npx vitest run`), `npx tsc --noEmit`, `npm run lint`; before/after timings with the production-build probe of L3.

## Specs

- S1 "cada vez que entro o cambio de activo, tarda en cargar y tamb los dibujos ya olertas": opening Gráficos on an asset (`/trading?symbol=X`) loads only X; today it loads the last asset first (candles, alerts, drawings, quote), then X (L3).
- S2 The drawings of an asset arrive in one round trip: today an asset with no saved drawings asks again for the old format, in sequence, on every visit (L3).
- S3 Drawings and alerts never wait on a second request (S2) and an asset seen recently never shows "Cargando…" (S4). Decided by me (L4): the previous chart does not stay on screen while a new asset loads, since its candles would sit under the new asset's drawings.
- S4 An asset and timeframe seen recently opens at once from memory and refreshes behind; the server keeps candles longer than 30 s without staling the live bar; a ticker Yahoo does not know is not retried.
- S5 No duplicate requests on the chart page (`/api/positions` two or three times, `/api/quote` twice).
- S6 "quiero que lo optimices, que ande bien tapido, todo el proyecto en si, Busquemos maneras d emejoar el rendmiento": the same audit and fixes for every other page (specs added from the audit, L4).

## Tasks

| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 Open on ?symbol= without loading the last symbol | S1 | inline | done: RED→GREEN (page test: only BTCUSDT mounted, no SPY quote) | c853dec |
| T2 Drawings in one request (server reads the old format) | S2 | inline | done: 4 RED→GREEN (route returns legacy rows with a null set, never reads legacy for a saved ticker, legacy error 500; hook makes one request and saves the conversion once) | 36414e8 |
| T3 No opaque overlay on a switch; drawings and alerts as they arrive | S3 | inline | folded into T2 and T4 (L4) | |
| T4 Client memory per asset/timeframe; server candle cache; no retry on unknown ticker | S4 | inline | done: RED→GREEN: history + recent window together, poll asks the window only, a seen asset ready at once, unseen still loading; mergeRecent; route TTL 600 s history / 30 s window; Yahoo asks an unknown ticker once | (this commit) |
| T5 Chart page duplicates | S5 | inline | pending | |
| T6 App-wide (from the audit) | S6 | inline | pending | |
| T7 Before/after measurement, suite, verifier when a task names a high-risk item | all | inline | pending | |

## Log

- L1 (2026-10-24, user, asked when they felt the chart slow): "cada vez que entro o cambio de activo, tarda enc aregagar y tamb los dibujos ya olertas"
- L2 (2026-10-24, user, after the measured findings and proposal): "quiero que lo optimices, que ande bien tapido, todo el proyecto en si, Busquemos maneras d emejoar el rendmiento"
- L3: measured. The app is in Ashburn VA (ipinfo), Supabase us-east-1: server↔DB is near and the user's data is small (6 drawing sets, 5 alerts). From Argentina every request to the app costs ~170 ms (`/api/health`, memory-cached, TTFB 170-190 ms). Production build of feat/chart-mobile in a scratch clone, app API stubbed with 200 ms, Chromium 390px: first load candles ready 0.75 s (1x CPU), 1.3 s (4x); a symbol switch 0.6-1.5 s at 4x, mostly native canvas redraw of 6 panes plus indicator recompute; live ticks ~4% CPU at 4x. Waterfall: `?symbol=BTCUSDT` first fetched SPY's klines, alerts, drawings and quote; drawings for a never-saved ticker went `/api/chart-drawings` → `/api/drawings` in sequence. Code map: every API route calls `supabase.auth.getUser()` (cheap from Ashburn), klines cached 30 s in Redis, Yahoo `withRetry` retries NOT_FOUND, no client cache, `/api/positions` from AppShell + PnLSidebar + every SymbolSelector open, `/api/quote` twice. First Load JS per route 88-330 kB (trading 330).
- L4: the previous chart staying on screen during a switch was dropped: the new asset's drawings would draw over the old asset's candles, and after S2 drawings and alerts arrive in one round trip, usually before the candles. The win is not showing "Cargando…" for an asset seen recently (S4). Found while doing T4: a stock's chart re-polled the full 10-year history every 30 s with a 30 s server cache, so nearly every poll was a fresh Yahoo download; now the history loads once (10 min server cache) and the poll asks a 7-400 day window (30 s).
