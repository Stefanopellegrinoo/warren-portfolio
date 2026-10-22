# Trading chart — professional, TradingView-like

Objective: fix the slow load and the broken drawings and alerts on `/trading`, then redesign the page with the approved visual system.
Branch: `feat/trading-chart`. Delivery: ask-on-risk. Test runner: vitest (`npm test`).
Base library, chosen by the user: lightweight-charts 5.2 + `lightweight-charts-drawing` (pinned 0.6.2) behind an adapter.

## Specs

- S1: "tarda mucho en cargar". The chart is usable fast. Measured cause: candles fetched from epoch with no cache (`yahoo.ts:33`, 0.6–0.9 s and 11.5k bars for AAPL vs 0.2–0.3 s for 2 years); `PriceChart` mounted twice (`trading/page.tsx:84,94`); four quote polls; every tick recomputes every indicator over all bars; `catch {}` turns errors into endless "Cargando...". Acceptance:
  - one chart instance;
  - a bounded range per timeframe, cached on the server;
  - live ticks update only the last bar;
  - a failed load shows an error with a retry.
- S2: timeframes are honest. Yahoo intraday comes from `yf.chart()` (15m up to 60 days, 1h up to 730 days); no timeframe silently shows daily bars. A timeframe the source cannot serve is not offered.
- S3: "los dibujos ... andan muy mal". The drawing layer is the plugin's `DrawingManager`. Acceptance:
  - multi-click tools work: trend line, ray, extended line, horizontal line/ray, vertical line, parallel channel, fib retracement, rectangle, price range, long/short position, text, brush;
  - anchors drag, the body drags, Delete removes, Escape cancels;
  - magnet, hide all, lock, and remove all;
  - every create, move or delete persists, and a failed save is visible to the user.
- S4: the existing 18 drawings survive. `horizontal_ray` and `channel` rows convert to `horizontal-ray` and `parallel-channel`. The old table is kept untouched.
- S5: "alertas andan muy mal". Acceptance:
  - the chart shows only the current ticker's alerts;
  - an alert can be created at a price from the chart, moved by dragging, and deleted from the chart;
  - a triggered alert can be re-armed.
- S6: alert evaluation fires on a real cross: previous price on one side, current price on or past the line. It evaluates every ticker that has an active alert, not only held positions.
- S7: "dejarlo profesional y que ande como tradingview". `/trading` adopts the approved style: tokens from `globals.css` and the style spec `docs/superpowers/specs/2026-10-21-rediseno-ui-design.md`, with no `tv-*` glass/amber/uppercase-mono. It is responsive 320–1920 px with no horizontal scroll, in light and dark.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1, S2 | inline | done | 44914a1 (+60 s TTL in 9a72184); RED→GREEN klines route 5 tests, provider 3 tests |
| T2 | S1 | inline | done | 9a72184; browser: 1 AAPL klines request, error+retry, 15m interval, 375 px no scroll |
| T3 | S3, S4 | inline | done (migration 042 applied 2026-10-22, user OK) | 81a9c76 + 9a72184; browser: legacy 2 rows converted+saved, trend line/fib placed, Delete removes |
| T4 | S5, S6 | backend delegated (writer: parallel unit), UI inline | done (prod worker unverified) | ed534ee + 9a72184; browser: create, select, re-arm, drag PATCH |
| T5 | S7 | delegated (context backstop) | done | 7a73555, 0fac55d, d15a5f3; sweep 11 widths x 2 themes PASS; 1838 tests |

- T1: market data. `/api/klines` takes `interval` in 15m/1h/1d/1w/1mo with a bounded range per interval, uses `yf.chart()` for intraday, and adds a Redis cache (TTL 60 s intraday, 15 min daily+). The CCL lookup covers only the range.
- T2: a single chart core. Replaces `PriceChart` with one instance and a candles hook (abort on change, error state); live update via `series.update`; indicators in v5 panes. EMA add/remove and hide work; quote polls are consolidated.
- T3: drawings. Plugin + adapter + toolbar; new table `chart_drawing_sets (user_id, ticker, drawings jsonb)` with RLS and debounced PUT; migration 042 converts the old rows. Risk item 1, persisted format: needs user OK before applying to the shared Supabase.
- T4: alerts. Filter by `ticker` in the API; create/drag/delete on the chart; re-arm; the worker uses real crossing and the tickers of active alerts. Whether the prod worker runs is unverified; checking it needs ssh, with user OK.
- T5: visual redesign of `/trading` (header, watchlist, sidebars, bottom panel) plus the responsive sweep.

## Log

- L1 (2026-10-22, user): "Explora todo lo que tengas que hacer,hay que dejarlo profesional y que ande clmo tradingview"
- L2 (2026-10-22, user): library choice "LWC + plugin (Recommended)".
- L3 (2026-10-22, user): "Que tanta pregunta arranca, el cambio de ui solo lo hiciste del Dashboard que te pasa?" → skip questions; the other pages follow after Trading, one at a time (spec 2026-10-21 lists them as non-goals of the first project).
- L4: diagnosis evidence lives in memory `trading-diagnostico-2026-10-22`. Prod data: 18 drawings (17 `horizontal_ray`, 1 `channel`); 6 alerts (5 triggered, last 2026-07-02).
- L5: T1-T4 done in 4 commits. Note: timeframes.ts was written together with its test (RED not observed); every later module observed RED first. Design correction: live Yahoo bars come from re-polling /api/klines (TTL 60 s) because rolling bars from quotes invented bars after the close.
- L6: pending user decisions: apply migration 042 to the shared Supabase (without it /api/chart-drawings returns 500 and the chart shows "Dibujos sin guardar"); ssh to prod to check that the worker container runs.
- L7 (2026-10-22, ssh read-only with user OK, host `portfolio`): prod worker `warren-portfolio-worker-1` runs, job every 5 min (skipped while market closed). TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are UNSET in the worker; log: "Telegram disabled". Triggered alerts therefore change status silently and never notify — a root cause of "alertas andan muy mal" outside the code.
