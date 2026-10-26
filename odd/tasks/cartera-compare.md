# Cartera list, Mi cartera chart, compare any assets
Branch `feat/cartera-compare` (on top of `fix/trade-markers-mobile`). Delivery: single PR, ask-on-risk. Runner: vitest.
Design: docs/superpowers/specs/2026-10-26-cartera-compare-design.md. Plan: docs/superpowers/plans/2026-10-26-cartera-compare.md.

## Specs
- S1 "Que una lista por defecto sea la cartera de acciones" — automatic Cartera list, first, held stocks + CEDEARs, not editable (design Goals 1–2).
- S2 "Pero mi cartera se va a poder ver como un gráfico tipo de una acción?" — Mi cartera in the trading chart as a line (design Goal 3).
- S3 "Y después voy a poder compararlo contra otro activo? Esto de comprar también quiero poder hacerlo entre cualquier activo" / "Compara rendimientos, contra etfs" — + Comparar on every chart, % scale, USD (design Goals 4–5, anti-goals).

## Tasks
- T1 S2,S3 compare-series endpoint — inline — done (b9fd4d8)
- T2 S3 pure compare helpers — inline — done (23a31a6)
- T3 S2 Mi cartera as a chart — inline — done (8a30fee)
- T4 S1 Cartera list — inline — done (029909e)
- T5 S3 compare on any chart — inline — done (e3fc927)
- T6 S1–S3 page wiring + checks + UI probe — inline — done (a5610d9)

## Log
- L1 (2026-10-25) "De paso quiero que agregues que una de la listas por defecto sea la cartera, entiendes? Que una lista por defecto sea la cartera de acciones y que se pueda hacer gráfico para comparar contra otros activos a elección"
- L2 (2026-10-26) Mockups approved: "Está bien". Design approved: "Si".
- L3 (2026-10-26) "Pero mi cartera se va a poder ver como un gráfico tipo de una acción? Y después voy a poder compararlo contra otro activo? Esto de comprar también quiero poder hacerlo entre cualquier activo" → revised design approved "Si"; my calls approved "Si"; execution: inline (Native).
- L4 (2026-10-26) T1–T6 committed (b9fd4d8..a5610d9); full suite 2863/2863, tsc clean, eslint: one new set-state-in-effect warning in Watchlist (ruling). Pending: UI probe, final whole-branch review.
- L5 (2026-10-26) Final review (opus) + UI probe: 1 critical (client bundle reached yahoo-finance2), 9 important fixed in 3714ad9 and 4477f4a; suite 2875/2875, tsc clean; 36 probe shots with no horizontal scroll and no console errors; /probe compiles (HTTP 200). Rulings and deferred minors:
  - - T1 → T5: `isArsSymbol` consumed client-side, but T1 puts it in `src/lib/compare-series.ts` next to the server loader. Ruling: `src/lib/compare-series.ts` holds only pure, client-safe exports (parseCompareSymbols, isArsSymbol, yahooSymbol, toUsdDaily, SeriesResult, PORTFOLIO_SYMBOL import-free); the server loader `loadStocksTwr` goes to `src/lib/stocks-twr.ts` — a client import of the server module would bundle supabase/redis — cost if wrong: one file move.
  - - T3 → T4/T5/T6: PORTFOLIO_SYMBOL, CARTERA_LIST_ID, MAX_COMPARE, compareSymbols. T1 also needs '__portfolio__': Ruling: T1 uses its own literal constant `PORTFOLIO_SERIES = '__portfolio__'` in compare-series.ts and chart-store re-exports the same value as PORTFOLIO_SYMBOL from there — one source of truth — cost if wrong: none.
  - Task 1: Ruling: loadStocksTwr test written after the code — RED proven by mutation (dropping declared transactions fails 'a stock bought in between') — cost if wrong: none
  - Task 3: Ruling: added seriesLabel() to compare-series.ts now (loading text said __portfolio__) — T5 legend and T6 header reuse it — cost if wrong: none
  - Task 3: Ruling: chart-store and resolver import compare-series by relative path — worker-imports guard test: the worker image has no @/ paths — cost if wrong: worker crash at startup (guarded by test)
  - Task 4: Ruling: addSymbolToCurrentWatchlist with Cartera shows a toast ('Cartera se arma sola con tus acciones: elegí otra lista para agregar') and returns mode 'cartera' — the header star can still call it — cost if wrong: copy change
  - Task 5: Ruling: useCompareSeries(symbols, ccl) instead of (main, symbols, enabled) — the caller already removes the main symbol and an empty list means idle — cost if wrong: none
  - Task 5: Ruling: the compare legend lives inside TradingChart's legend block (no CompareLegend.tsx) — it needs the chart's hover, visible range and theme — cost if wrong: a later extraction
  - Task 5: Ruling: added pctFrom() (legend % from the first visible bar, like the % scale) and a main-series row in the legend so "who is ahead" reads at a glance — spec Goal 4 — cost if wrong: one legend row
  - Task 5: Ruling: Mi cartera's top line reads "Valor X" instead of Ap/Máx/Mín/Cie (all equal for a line) — cost if wrong: copy
  - Task 5: Ruling: price scale mode only set when comparing flips on/off, so a chart never compared is never touched — anti-goal "with nothing compared, behaves as today" — cost if wrong: none
  - Task 6: Ruling: Watchlist Effect C keeps setLoading/setLoadError at the start of the effect (one new react-hooks/set-state-in-effect warning) — same idiom as Effect B next to it — cost if wrong: a lint warning
  - Task 6: Ruling: useCompareSeries derives loading/idle from the request key instead of setting state in the effect — removes the new lint warning — cost if wrong: none
  - Final: Ruling: probe's legend-vs-axis % mismatch at 1280 not reproduced in a test (legend base = first bar of the strict visible range, same rule as LWC Series.firstValue, verified in lightweight-charts 5.2.0 source); no blind fix — cost if wrong: legend % differs from the axis label until verified on the device
  - Final: Ruling: handleRemove guard for the Cartera id added — the spec asks for a check in each place that treats the id as a uuid — cost if wrong: none
  - Final: Ruling: SPY default fires once per device (compareDefaulted), and the shared comparison list still applies to every chart — spec: "Default the first time"; one list shared by every chart was an approved call — cost if wrong: the user may want per-chart lists
  - Final: Ruling: when a peso chart is compared, drawings are re-shown on exit with setDrawingsVisible(true), overriding a "hide drawings" chosen before comparing — cost if wrong: one tap to hide them again
  - Final: minor (deferred): peso→USD conversion is O(n×m) (linear closeOnOrBefore per bar)
  - Final: minor (deferred): weekly/monthly peso charts use the CCL of the bar's first day
  - Final: minor (deferred): every Binance live tick re-runs alignToBars/setData for compared lines
  - Final: minor (deferred): lines flicker while a new comparison loads
  - Final: minor (deferred): foreign listings (SAP.DE, PETR4.SA) compared in their own currency
  - Final: minor (deferred): CompareSheet's limit counts the main symbol when it is in the stored list
  - Final: minor (deferred): ^MERV as main chart labelled "MERVAL (USD CCL)" while in pesos
  - Final: minor (deferred): failed comparison request has no retry
  - Final: minor (deferred): /api/compare-series has no rateLimit
  - Final: minor (deferred): fittedRef condition may refit with the old bar count on a symbol switch (cosmetic)
  - Final: minor (deferred): Mi cartera asks for its trades and alerts (/api/transactions, /api/price-alerts with __portfolio__)
  - Final: minor (deferred): TradingChart.tsx past 800 lines
  - Final: minor (deferred): % axis uses English number format, legend Spanish
  - Final: minor (deferred): crowding at 320 px (legend without background, axis labels collide)
  - Final: minor (deferred): default-symbol requests before the stored state loads (pre-existing)
  - Final: Ruling: compare legend rows, notes and + Comparar get a solid bg-canvas background and shorter copy ('Medias y Bollinger: ocultas al comparar', 'Dibujos y alertas: en pausa al comparar en dólares') — the 320 px probe showed my new notes wrapping over the lines — cost if wrong: copy
