# Day change: the four defects of the 2026-11-04 audit

Objective: fix the four day-change defects found by the audit of the Mi cartera chart and the daily change (the chart's TWR itself was found right). Branch `fix/day-change` from `master` cc1f1f9; one PR to `master` with the owner's OK.
Runner: vitest (`npm test`), `npm run type-check`, `npm run lint`; a differential check of the old and new day-change math on the same inputs.

## Specs

- S1 Gráficos "Mi cartera" row shows the real day %. Audit finding 1 (approved, L2): `day_change_pct` is a fraction (yahoo-finance.ts:105) but `Watchlist.tsx:347` divided it by 100 again, so +1,23 % read +0,01 %. Acceptance: the row shows `formatPct` of the fraction (+1,23 % for 0.0123); `portfolioDayChangePct`'s test uses fractions as `/api/positions` sends them.
- S2 Hovering an older bar of the Mi cartera chart shows that bar's change. Audit finding 2 (approved, L2): the legend computed `(close − open)/open`, always 0 on the portfolio's flat bars. Acceptance: on the portfolio series, a hovered bar's change is against the previous bar's value (as the last bar already is); other symbols' candles keep their current legend.
- S3 Resumen "hoy %" is today's move, not over cost. Audit finding 3 (approved, L2; the owner was told it lowers the % in gains and raises it in losses): the % was `dayChange / invested`. Acceptance: `dayChangePct = dayChange / (value − dayChange)` over the positions that have a day change, in every currency view (`multicurrency.ts`) and in the engine's fallback (`portfolio-engine.ts` `day_pnl_pct`, total / stocks / ons); the money amount (`dayChange`, `day_pnl`) is unchanged; a portfolio with no priced day change keeps 0 / null as today.
- S4 No 0 % "today" on days without a session. Audit finding 4 (approved, L2): the portfolio series always ends with today's point at the live price, equal to the last close on weekends and holidays, so the chart's last-bar change read 0 %. Acceptance: the Mi cartera series drops today's point on a Saturday or Sunday (Argentina's day), and on any day when that point did not move from the previous one (no session: every price still the last close); a weekday with a session keeps today's live point; the other derived series (Resumen, Rendimiento) are unchanged.

## Tasks

| ID | Specs | Route | Status | Evidence |
|----|-------|-------|--------|----------|
| T1 | S1 | inline | done, verified | commit 5baf017; Watchlist flow test RED ("+0,01 %" received for "+1,00 %") → GREEN; fixtures now fractions as /api/positions sends them |
| T2 | S2 | inline | done, verified | commit 09f9c8a; `barChange` 4 tests RED → GREEN (flat hovered bar vs previous; candles unchanged; flat first bar null) |
| T3 | S3 | inline | done, verified | commit 49fd76b; multicurrency totals test RED → GREEN (pct = day / (value − day), same in ARS/MEP/CCL; the amount pinned unchanged); engine test RED → GREEN (total, stocks, ons; nothing priced → 0) |
| T4 | S4 | inline | done, verified | commit 4d67576; `dropIdleToday` 4 tests RED → GREEN; route test on a Saturday fails on the old route (stash check) and passes; `stocks-twr` and derived series untouched |

- T1 Watchlist "Mi cartera" row displays the fraction; fix the unit test's units.
- T2 Chart legend: portfolio bars change vs the previous bar on hover.
- T3 Day % over yesterday's value in `multicurrency.ts` and `portfolio-engine.ts`.
- T4 Drop the portfolio series' idle "today" point in the compare-series path only.

## Log

- L1 (2026-11-04, user): "Si. Ahora quiero que te fijes si el cálculo del gráfico de la cartera está bien, y también el cambio diarios"
- L2 (2026-11-04, user, on the audit report listing four defects): "si, arreglá los cuatro con odd, hacelo bien y con cuidadio"
- L3 Audit (read-only, explorer + parent spot checks): the Mi cartera chart is the stocks-only flow-adjusted TWR (`drawdown.ts:166`), unchanged since the 2026-10-26 independent replica that matched to the cent; #46/#47/#48/#53/#56 do not touch it. Defects as S1–S4, each confirmed in code by the parent (Watchlist.tsx:347, TradingChart.tsx:779 with useCandles.ts:67 flat bars, multicurrency.ts:321, derive-history.ts:201). Consumers of the day %: only the Resumen headline (`resumen/currency.ts:50,61`). Owner's value/cost on the 10-22 snapshot ≈ 1.05, so S3 moves their % by about 5 %.
- L4 Outcomes. Suite 3778 pass, `tsc` clean, lint 0 errors (the 6 warnings in TradingChart/Watchlist are the base's). `dropIdleToday` lives in the pure `twr-series.ts` (the route test mocks `stocks-twr`). Consumers re-checked: the day % is read only by the Resumen headline; `loadStocksTwr` only by `/api/compare-series`. RDD assess (base cc1f1f9, committed-only): see the PR. Risk: none — UI display (S1, S2), a requested change of the Resumen day % (S3, its only consumer the headline), and the portfolio chart route only (S4). Next: the owner's OK to merge.
