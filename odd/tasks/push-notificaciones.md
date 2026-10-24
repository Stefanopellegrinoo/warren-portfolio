# Push notifications

Objective: a price alert that fires reaches the user's iPhone as a push notification of the installed app.
Branch `feat/push`, stacked on `feat/ux-pages` (594d05b). Delivery: stacked to master after `feat/ux-pages`. Tests: vitest (`npx vitest run`), `npx tsc --noEmit`, `npm run lint`.

## Specs

- S1 "quiero poner notificaciones push": when a price alert fires, every device where the user turned notifications on gets a push notification in Spanish, with the ticker, the crossed value and the current price; tapping it opens the chart of that ticker (`/trading?symbol=<ticker>`). Decided by me: price alerts only for now (the place where Telegram is used today); strategy signals can reuse the same channel later.
- S2 Turning it on inside the installed app: a "Avisos en este dispositivo" card in Estrategias y alertas → Alertas. iOS only allows the permission prompt from a tap, so the card asks only when the user taps "Activar avisos". States: not available here (not installed on the Home Screen, or a browser without push) with how to install it; blocked (how to allow it in the iPhone settings); off ("Activar avisos"); on ("Este dispositivo recibe los avisos.", "Enviar una prueba", "Desactivar"); not configured on the server. Every failure says what happened (S1 of `odd/tasks/ux-paginas.md`). The alerts list copy says how alerts are delivered.
- S3 Server side: each device's subscription is stored per user (migration 050, owner-only RLS). `GET /api/push` answers the public VAPID key from the runtime env (not baked into the image); `POST /api/push` saves the device; `DELETE /api/push` removes it; `POST /api/push/test` sends a test notification to the user's devices (rate limited). Only push-service endpoints are accepted (https on a known push host), so the server never POSTs to an arbitrary URL. A subscription the push service reports gone (404/410) is deleted.
- S4 The price worker sends the push right after it marks the alert triggered; Telegram stays as it is (its own decision is still pending, `odd/tasks/ux-paginas.md` S8); a push failure is logged and never stops the worker.
- S5 Deploy: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` reach the app and the worker through `docker-compose.yml`; the user sets their values in the server's `.env` and applies migration 050 in the SQL Editor. Without the keys nothing breaks: the card says it is not configured and the worker logs it at startup.

## Tasks

| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 `web-push` dependency and `src/lib/push.ts` (send to a user's devices, drop gone subscriptions, configured check) | S3, S4 | inline | | |
| T2 Migration 050 and `/api/push` (key, subscribe, unsubscribe, test) with the endpoint allowlist | S3 | inline | | |
| T3 Service worker code `worker/index.js`: show the push, open its page on tap | S1 | inline | | |
| T4 Client: subscription hook and the "Avisos en este dispositivo" card, alerts copy | S2 | inline | | |
| T5 Price worker sends the push; compose env; startup log | S4, S5 | inline | | |
| T6 Suite, independent verifier (Risk items 1, 2, 5), native review, deploy steps for the user | all | inline + verifier | | |

Route evidence: the units share one contract (the payload and the `/api/push` shape) and each is about 100 lines or less, so they run inline one after another.

## Log

- L1 (2026-10-24, user, after the UX project 3 report asked whether Telegram delivers price alerts): "antes de telegram, quiero poner notificaciones push, se puede?"
- L2 (2026-10-24, user, after the feasibility answer: iOS 16.4+, installed app only, permission from a tap, VAPID keys in the server env, `web-push`, a new table): "perfecto, vamos a ello"
- L3: map (read-only explorer). The worker marks an alert triggered (`src/lib/price-worker.ts:181-184`) and then calls `sendTelegram` ignoring the result (:193); `docker-compose.yml` passes no `TELEGRAM_*` to the worker, so as committed no alert reaches anyone. The worker is a separate compose service on the same image (`npm run worker`), with the service-role client. next-pwa 5.6 bundles `worker/index.(js|ts)` into `public/worker-<buildId>.js` and imports it from `sw.js` in production builds only. The deploy script on the server runs `git pull`, `compose pull` and `up -d`, so it uses this repo's `docker-compose.yml` with the server's `.env`. Next migration number: 050.
