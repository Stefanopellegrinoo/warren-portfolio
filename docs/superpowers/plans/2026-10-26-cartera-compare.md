# Cartera list, Mi cartera chart and compare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An automatic "Cartera" list, "Mi cartera" as a line chart in the normal trading chart, and "+ Comparar" on every chart between any assets, all in USD.

**Architecture:** One authenticated endpoint returns daily USD series for N symbols plus the `stocks` TWR (`__portfolio__`), with the CCL when asked. `useCandles` gets a third source for `__portfolio__`; `TradingChart` draws a `LineSeries` for it and, while comparisons exist on a daily+ timeframe, adds one `LineSeries` per comparison and switches the right scale to `PriceScaleMode.Percentage`. The Cartera list is a sentinel watchlist id fed by `getPortfolio()`.

**Tech Stack:** Next.js 14 App Router, TypeScript, zustand (persist), lightweight-charts 5.2.0, vitest + Testing Library, Supabase, Redis route cache.

**Spec:** `docs/superpowers/specs/2026-10-26-cartera-compare-design.md`

## Global Constraints

- UI copy, exactly: "Cartera", "Mi cartera", "Rendimiento de las acciones", "+ Comparar", "Comparar con", "Buscar otro", "Sin datos", "Las comparaciones se ven en diario, semanal o mensual", "No tenés acciones en cartera", "Todavía no hay historia de tu cartera".
- Quick picks in order: SPY, QQQ, DIA, EEM, VT, MERVAL (USD CCL) = symbol `^MERV`.
- `PORTFOLIO_SYMBOL = '__portfolio__'`, `CARTERA_LIST_ID = '__cartera__'`, `MAX_COMPARE = 5`.
- Portfolio series = `computeUniverseTwr(rows, 'stocks', …)` with the `/api/statistics` inputs, values `twrIndex × 100`. Never raw value.
- Every compared series in USD: `.BA` suffix or `^MERV` → divided by that day's CCL; while comparing, an ARS-quoted main chart is divided too. Crypto `XXXUSDT` → Yahoo `XXX-USD`.
- Comparisons only on `1d`, `1w`, `1M`; Mi cartera offers only `1d`.
- With nothing compared, every existing chart, timeframe, indicator, drawing, alert and list behaves exactly as today.
- 320 px with no horizontal scroll; sheets via `ChartSheet`. Tests first; no `next build` in the workspace; UI probes in a `mktemp -d` clone; conventional commits without AI attribution.

## Review Focus

1. A comparison ticker with no data (typo, delisted) → legend "Sin datos", other lines draw, request does not fail (Task 1, Task 5 tests).
2. Switching from an intraday chart with comparisons to `1d` and back → lines hide/show, scale returns to normal when hidden (Task 5 test).
3. A user with no stock positions → Cartera says "No tenés acciones en cartera"; Mi cartera with no snapshots says "Todavía no hay historia de tu cartera" (Tasks 4, 3 tests).
4. Persisted `symbol: '__portfolio__'` but opened via `?symbol=AAPL` → AAPL candles (Task 6 test).
5. `activeWatchlistId === '__cartera__'` never reaches `/api/watchlist` (Task 4 test).

---

### Task 1: Compare-series endpoint

**Files:**
- Create: `src/lib/compare-series.ts`, `src/app/api/compare-series/route.ts`
- Test: `src/lib/__tests__/compare-series.test.ts`, `src/app/api/compare-series/__tests__/route.test.ts`

**Interfaces:**
- Produces:
  - `parseCompareSymbols(raw: string | null): string[] | null` — split on `,`, trim, uppercase (except `__portfolio__` kept as is), dedupe; each matches `/^\^?[A-Z0-9][A-Z0-9.=-]{0,14}$/` or equals `__portfolio__`; 1–5 symbols; else `null`.
  - `isArsSymbol(s: string): boolean` — `.BA` suffix or `^MERV`.
  - `yahooSymbol(s: string): string` — `XXXUSDT` → `XXX-USD`; else unchanged.
  - `toUsdDaily(bars: DailyBar[], ccl?: DailyBar[]): { time: string; value: number }[]` — each bar's close, divided by `closeOnOrBefore(ccl, date)` when given; bars without a CCL dropped.
  - `type SeriesResult = { points: { time: string; value: number }[] } | { error: 'no_data' }`
  - `GET /api/compare-series?symbols=…&ccl=1` → `{ series: Record<string, SeriesResult>; ccl?: { time: string; value: number }[] }`; 400 `{ error: 'Elegí entre 1 y 5 activos para comparar' }`.
  - `__portfolio__` → `{ points: twr.map(p => ({ time: p.date, value: p.twrIndex * 100 })) }`, or `no_data` when empty.
- Consumes: `getDerivedSeries`, `fetchExternalFlows`, `fetchFlowTransactions`, `fetchIncomeMovements`, `ledgerFlows`, `computeUniverseTwr`, `getBars`, `getHistoricalCCL`, `closeOnOrBefore`, `requireUser`, `getCachedRoute`/`cacheRoute`, `serverError`.

- [ ] **Step 1: Failing tests**
  - `parseCompareSymbols('spy, dia,SPY')` → `['SPY','DIA']`; `('^MERV,GGAL.BA,__portfolio__')` kept; `('')`, `(null)`, six symbols, `('SPY;DROP')` → `null`.
  - `isArsSymbol('GGAL.BA')`, `('^MERV')` → true; `('SPY')` → false. `yahooSymbol('BTCUSDT')` → `'BTC-USD'`; `('SPY')` → `'SPY'`.
  - `toUsdDaily([{date:'2026-01-02',close:10000},{date:'2026-01-05',close:12100}], [{date:'2026-01-02',close:1000},{date:'2026-01-05',close:1100}])` → values `10`, `11`.
  - Route (mocks as in the statistics route tests): 400 with the exact message for missing and six symbols; `SPY,ZZZZ` with no bars for ZZZZ → 200 and `series.ZZZZ` = `{ error: 'no_data' }`; `GGAL.BA` → `getHistoricalCCL` called, `SPY` → not; `ccl=1` → response has `ccl`; `__portfolio__` → TWR mapped ×100; the TWR inputs are loaded only when `__portfolio__` is requested.
- [ ] **Step 2: Run** `npx vitest run src/lib/__tests__/compare-series.test.ts src/app/api/compare-series` — FAIL (modules missing).
- [ ] **Step 3: Implement.** `loadStocksTwr(supabase, userId): Promise<TwrPoint[]>` in `src/lib/compare-series.ts` reproduces the statistics route's non-`total` inputs. One `getBars(symbols.map(yahooSymbol), from, { maxAgeSec: 300 })`, `from` = today − 10 years (bars are cached); CCL fetched once if any symbol is ARS or `ccl=1`. Cache 300 s under `statistics:v4:${user.id}:compare:${sorted symbols}${ccl ? ':ccl' : ''}`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(chart): endpoint for daily USD series of any assets and the portfolio`

### Task 2: Pure helpers for comparing

**Files:**
- Create: `src/lib/chart/compare.ts`
- Test: `src/lib/chart/__tests__/compare.test.ts`

**Interfaces:**
- Produces:
  - `COMPARE_TIMEFRAMES: Timeframe[] = ['1d', '1w', '1M']`
  - `alignToBars(barTimes: number[], daily: { time: string; value: number }[]): { time: number; value: number }[]` — for bar `i`, the last daily value with `toChartTime(time) < barTimes[i+1]` (the last bar takes the latest); bars before the first daily value are skipped.
  - `toUsdCandles(candles: Candle[], ccl: { time: string; value: number }[]): Candle[]` — OHLC divided by the CCL on or before each candle's day; candles with no CCL dropped.
  - `portfolioDayChangePct(positions: { market_value?: number; day_change_pct?: number }[]): number | null` — market-value-weighted mean; `null` when total value is 0.
- [ ] **Step 1: Failing tests**
  - `alignToBars` daily: bar times = the daily times → same values. Weekly: bars `2026-01-05`, `2026-01-12` (as chart seconds) with daily values Mon–Fri of both weeks → first bar gets Friday `2026-01-09`'s value, second the last one.
  - `toUsdCandles` with OHLC `1000/1100/900/1050` and CCL `1000` → `1/1.1/0.9/1.05`.
  - `portfolioDayChangePct([{market_value:300,day_change_pct:2},{market_value:100,day_change_pct:-2}])` → `1`; `([])` → `null`.
- [ ] **Step 2: Run** `npx vitest run src/lib/chart/__tests__/compare.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(chart): align daily USD series to chart bars`

### Task 3: Mi cartera as a chart

**Files:**
- Modify: `src/lib/store/chart-store.ts` (constants, `compareSymbols`)
- Modify: `src/lib/market-data/resolver.ts` (`DataSource` adds `'portfolio'`; `getProviderForSymbol('__portfolio__')` → `'portfolio'`)
- Modify: `src/lib/chart/timeframes.ts` (`OFFERED.portfolio = ['1d']`)
- Modify: `src/components/trading/chart/useCandles.ts` (portfolio branch)
- Modify: `src/components/trading/chart/TradingChart.tsx` (line series for the portfolio; no alerts/trade arrows there)
- Modify: `src/components/trading/chart/SymbolSelector.tsx:145-155` (callback mode calls only the callback)
- Test: `chart-store.test.ts`, `timeframes` test, `useCandles` test, `TradingChart.test.tsx`, SymbolSelector test

**Interfaces:**
- Produces (from `chart-store.ts`): `PORTFOLIO_SYMBOL`, `CARTERA_LIST_ID`, `MAX_COMPARE`; state `compareSymbols: string[]` (default `[]`, persisted) and `setCompareSymbols(symbols: string[]): void` (dedupe, first `MAX_COMPARE`).
- `useCandles('__portfolio__', '1d')`: fetches `/api/compare-series?symbols=__portfolio__` once (no polling), maps points to candles with `open = high = low = close = value`, `volume = 0`; `no_data` → status `error` with "Todavía no hay historia de tu cartera".
- `TradingChart`: when `symbol === PORTFOLIO_SYMBOL` the main series is a `LineSeries` fed `{ time, value: close }` (chart recreated when switching between line and candles); the alert button and trade arrows are not offered; indicators work as for any symbol, volume hidden.
- [ ] **Step 1: Failing tests**
  - Store: default `compareSymbols` `[]`; `setCompareSymbols(['A','B','A','C','D','E','F'])` → `['A','B','C','D','E']`; survives rehydrate.
  - `timeframesFor('portfolio')` → `['1d']`; `coerceTimeframe('1h','portfolio')` → `'1d'`.
  - `useCandles` portfolio: fetch URL as above, candles with equal OHLC; `no_data` → error message.
  - `TradingChart` with `'__portfolio__'`: `addSeries` called with the line series definition, not candlestick; no alert button; switching to `'AAPL'` adds a candlestick series again.
  - SymbolSelector callback mode: callback gets the ticker, `symbol` unchanged.
- [ ] **Step 2: Run** the listed tests — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS, plus `npx vitest run src/components/trading` unchanged elsewhere.
- [ ] **Step 5: Commit** — `feat(chart): Mi cartera opens as a line chart of its return`

### Task 4: The Cartera list

**Files:**
- Modify: `src/components/trading/watchlist/WatchlistSelector.tsx`, `Watchlist.tsx`, `src/lib/warren/watchlist.ts`
- Test: `src/components/trading/watchlist/__tests__/WatchlistSelector.test.tsx`, `Watchlist.flow.test.tsx`

**Interfaces:**
- Consumes: `CARTERA_LIST_ID`, `PORTFOLIO_SYMBOL` (Task 3), `portfolioDayChangePct` (Task 2), `getPortfolio()`.
- Menu shows "Cartera" first (no rename/delete), selecting it sets `activeWatchlistId = CARTERA_LIST_ID`. List: "Mi cartera" row (subtitle "Rendimiento de las acciones", value `portfolioDayChangePct`) → `setSymbol(PORTFOLIO_SYMBOL)`; then `positions[].ticker` rows; no remove, no add; empty → "No tenés acciones en cartera". `addSymbolToCurrentWatchlist` returns without a request for the Cartera id.
- [ ] **Step 1: Failing tests** — menu order "Cartera", "Lista local"; Cartera item has no rename/delete; with two mocked positions: rows "Mi cartera" + both tickers, no remove buttons, `fetch` never called with `/api/watchlist`; tapping "Mi cartera" → `symbol` `'__portfolio__'`; tapping a ticker → that ticker; no positions → empty message; existing tests unchanged.
- [ ] **Step 2: Run** `npx vitest run src/components/trading/watchlist` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(chart): automatic Cartera list with the held stocks`

### Task 5: Compare on any chart

**Files:**
- Create: `src/components/trading/chart/useCompareSeries.ts`, `src/components/trading/chart/CompareSheet.tsx`, `src/components/trading/chart/CompareLegend.tsx`
- Modify: `src/components/trading/chart/TradingChart.tsx` (compare series, % scale, "+ Comparar" button, legend)
- Test: `src/components/trading/chart/__tests__/Compare.test.tsx`

**Interfaces:**
- Consumes: Task 1 endpoint, `alignToBars`, `toUsdCandles`, `COMPARE_TIMEFRAMES` (Task 2), `compareSymbols`/`setCompareSymbols`/`MAX_COMPARE`/`PORTFOLIO_SYMBOL` (Task 3), `isArsSymbol`, `ChartSheet`, `SymbolSelector` callback mode.
- `useCompareSeries(main: string, symbols: string[], enabled: boolean): { series: Record<string, SeriesResult>; ccl?: … ; status }` — one fetch of `/api/compare-series?symbols=…` (symbols minus `main`, plus `&ccl=1` when `isArsSymbol(main)`), only when `enabled`.
- `TradingChart`: active comparisons = `compareSymbols` minus the main symbol, on `COMPARE_TIMEFRAMES` only. When non-empty: one `LineSeries` per comparison fed `alignToBars(mainBarTimes, points)`, the right price scale in `PriceScaleMode.Percentage`, an ARS main chart fed `toUsdCandles`. When empty or intraday: no compare series, scale `Normal`, original candles. Opening `PORTFOLIO_SYMBOL` with `compareSymbols` empty sets it to `['SPY']` once.
- `CompareLegend`: one row per comparison (label "Mi cartera" for `__portfolio__`, "MERVAL (USD CCL)" for `^MERV`, else the ticker), its color, its % at the crosshair or last bar, "Sin datos" for `no_data`, × → removes it. On intraday with comparisons: the single line "Las comparaciones se ven en diario, semanal o mensual".
- `CompareSheet({ open, onOpenChange, main })`: title "Comparar con"; checkboxes "Mi cartera" (hidden when `main` is the portfolio), then the six quick picks; at `MAX_COMPARE` unchecked boxes are disabled; "Buscar otro" opens the search in callback mode and appends the pick.
- [ ] **Step 1: Failing tests** (lightweight-charts mocked as in `TradingChart.test.tsx`)
  - AAPL `1d` with `compareSymbols ['SPY']` → a line series added, `priceScale('right').applyOptions` called with `mode: PriceScaleMode.Percentage`; legend row "SPY".
  - `compareSymbols []` → no compare fetch, scale mode `Normal` (behavior as today).
  - `'ZZZZ'` → `no_data` → legend "ZZZZ · Sin datos", no series for it.
  - `1h` with comparisons → no compare series, the intraday line shown; back to `1d` → series back.
  - × on SPY → `compareSymbols` `[]`, compare series removed, scale `Normal`.
  - GGAL.BA main with SPY → request has `ccl=1`, candles set are divided by the CCL.
  - Sheet: checking DIA → `['SPY','DIA']`; with 5 chosen the rest disabled; "Mi cartera" absent when main is the portfolio.
  - Opening `__portfolio__` with nothing compared → `compareSymbols` `['SPY']`.
- [ ] **Step 2: Run** `npx vitest run src/components/trading/chart/__tests__/Compare.test.tsx` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(chart): compare any assets on the chart in USD`

### Task 6: Page wiring and checks

**Files:**
- Modify: `src/app/trading/page.tsx` (`?symbol=` keeps winning; title shows "Mi cartera" for the sentinel)
- Test: `src/app/trading/__tests__/`

- [ ] **Step 1: Failing test** — store `'__portfolio__'` + `?symbol=AAPL` → `TradingChart` gets `AAPL`; store `'__portfolio__'` alone → header "Mi cartera", not `__portfolio__`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Full checks** — `npx vitest run`, `npx tsc --noEmit`, `npx eslint src` (no new warnings).
- [ ] **Step 6: UI probe** in a `mktemp -d` clone with mocked `/api/compare-series`, `/api/positions`, `/api/klines`: Cartera list, Mi cartera line, AAPL vs SPY+Mi cartera in %, the sheet; screenshots at 320, 390 light/dark and 1280; `scrollWidth` equals viewport everywhere.
- [ ] **Step 7: Commit** — `feat(chart): Mi cartera and comparisons on the Gráfico page`
