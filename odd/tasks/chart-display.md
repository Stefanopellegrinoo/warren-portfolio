# Chart display: the five errors of the 2026-11-04 chart audit

Objective: fix the five display errors the chart audit confirmed (indicators, daily data and the daily axis were verified right). Branch `fix/chart-display` from `master` 505a4a6; one PR to `master` with the owner's OK.
Runner: vitest (`npm test`), `npm run type-check`, `npm run lint`; a browser check of the real chart with real Yahoo bars in the Buenos Aires time zone for 1D, 1S, 1M, 15m and 1h; an independent verifier (shared provider code, see Risk).

## Specs

- S1 Daily, weekly and monthly bars show their own date. Audit error 1 (L1 screenshot: the 2026-11-03 candle labelled "2 de nov de 2026"; approved L2): those bars are calendar days at UTC midnight (`toChartTime`), and the crosshair formatter read them in Buenos Aires time, the day before. Acceptance: on 1D/1S/1M the crosshair label is the bar's own date (the 2026-11-03 bar reads "3 nov 2026"); intraday labels keep Buenos Aires time; the daily axis keeps its current labels.
- S2 One % per bar: against the previous close. Audit error 2 (L1: "la ulñtima vela de VST, la del 3, hizo +3.7, esa del 2 di +2.64"; approved L2): a hovered candle read open → close while the header and the unhovered last bar read against the previous close. Acceptance: the legend's % for any bar, hovered or not, last or not, candles or the flat Mi cartera line, is close ÷ previous bar's close − 1; the first bar shows no %; the 2026-11-03 VST bar reads +3,70 % hovered and unhovered, as the header.
- S3 No phantom bar on weekly and monthly. Audit error 3 (approved L2): Yahoo appends a live point (timestamp = the last trade, e.g. 2026-11-03T21:00:03) with that day's prices after the current week's or month's bar, and it was drawn as an extra candle. Acceptance: a trailing point that falls inside the previous bar's period (15m, 1h, 1d, 1wk, 1mo) is folded into that bar (its close becomes the point's price, high and low widen, volume unchanged) instead of drawn apart; the chart, the alerts and the strategy signals read the same bars (one shared helper); a bar of a new period is never folded.
- S4 Intraday axis in Buenos Aires time. Audit error 4 (approved L2): on 15m/1h the axis showed UTC hours (a 14:30–21:00 UTC session read 16:00…20:00) while the crosshair showed Buenos Aires time. Acceptance: intraday axis labels are Buenos Aires time with the same look as today (hours "13:00", day number, short month, year); daily and longer axes keep their current labels.
- S5 No loose live point at the end of 15m/1h. Audit error 5 (approved L2): Yahoo's trailing point (e.g. 11:16:19, volume 0) was drawn as an extra flat candle. Acceptance: covered by S3's fold (it lands inside the current 15m/1h bar); extended-hours bars with volume 0 stay as they are (the owner decides later).

## Tasks

| ID | Specs | Route | Status | Evidence |
|----|-------|-------|--------|----------|
| T1 | S1, S4 | inline | pending | |
| T2 | S2 | inline | pending | |
| T3 | S3, S5 | inline | pending | |
| T4 | S1–S5 | inline + independent verifier | pending | |

- T1 Time labels: one module for the crosshair label and the axis tick labels (UTC for daily and longer, Buenos Aires for intraday), used by the chart's options.
- T2 Legend %: every bar against the previous bar's close.
- T3 Fold Yahoo's trailing live point into the bar whose period it falls in, in the shared Yahoo bar helpers used by the provider (chart, alerts) and `fetchKlines` (signals).
- T4 Browser check with real bars on every timeframe in Buenos Aires time; independent verifier; differential check of the chart, alert and signal bars before and after.

## Log

- L1 (2026-11-04, user, interrupting a fix of the date label alone): "noo no es esaaa!!! la ulñtima vela de VST, la del 3, hizo +3.7, esa del 2 di +2.64, o capaz tenees razon y hay mas cosas que estan mal, porfavor antes de cambiar algo investiga, hay un monton de errores!!!!"
- L2 (2026-11-04, user, on the audit report listing five errors and their fixes): "si, arreglá los cinco con odd. HAcelo bien porfavor, basta de errores! tomate tu tiempo"
- L3 Audit (read-only; engram `audit/chart-display-2026-11-04`): VST indicators recomputed independently from real bars match the chart exactly (EMA 20/50/200, BB 20,2, RSI 14, MACD, Stoch 14,3,3, ADX 14, volume); production `/api/klines` returns the 2026-11-03 bar complete; daily axis ticks are real session days. Errors S1–S5 reproduced in Chromium with real bars (Buenos Aires time zone): the crosshair formatter `DAY` uses `America/Argentina/Buenos_Aires` on UTC-midnight daily bars; `TICK` formatters were defined but never used (the library's default ticks are UTC); `barChange` kept open → close for candles (#58); raw Yahoo `chart()` and `historical()` both return the trailing live point on 1wk/1mo, so the phantom predates #56. Shared consumers of the Yahoo bars: `/api/klines` (chart), `alert-candles.ts` (alerts), `signals-worker.ts` via `fetchKlines` (signals).
