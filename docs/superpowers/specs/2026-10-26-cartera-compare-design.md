# Cartera list, "Mi cartera" as a chart, and comparing any assets — design

Date: 2026-10-26. Mockups approved for the Cartera list ("Está bien"): https://claude.ai/artifact/UUQAngYDu6vUuZ9d4KR8cV. Revised the same day after the user asked: "Pero mi cartera se va a poder ver como un gráfico tipo de una acción? Y después voy a poder compararlo contra otro activo? Esto de comprar [comparar] también quiero poder hacerlo entre cualquier activo" — and approved the revised shape ("Si").

## Intent

The user's words: "Que una lista por defecto sea la cartera de acciones y que se pueda hacer gráfico para comparar contra otros activos a elección". What they compare: "Compara rendimientos, contra etfs". Where: the Gráfico page, "como lo de estadísticas pero mucho mejor hecho en gráficos".

Today the only portfolio-vs-benchmark view is the small recharts chart in Estadísticas (`src/components/charts/BenchmarkComparison.tsx`), with three fixed choices and no range. The user wants their stock portfolio to be a first-class asset on the trading chart they use every day on the iPhone PWA, and a TradingView-style "compare" that works between any assets: Mi cartera vs SPY, AAPL vs MSFT, GGAL vs MERVAL.

## Goals

1. **A "Cartera" list, always first** in the Gráfico lists menu (`WatchlistSelector`), above "Lista local". Nobody creates it; it shows the stocks and CEDEARs held right now (`getPortfolio().positions`). Buying a new one adds it; selling all of one removes it. It cannot be renamed, deleted or edited by hand.
2. **"Mi cartera" row on top of that list** (subtitle "Rendimiento de las acciones"), then one row per held ticker. Tapping a ticker opens its normal candle chart with trade arrows.
3. **"Mi cartera" opens in the same trading chart as any stock**: same toolbar, drawings and indicators that work on closes (moving averages, RSI, Bollinger, MACD). It is a **line, not candles** — the portfolio has one value per day and no open/high/low — and has no volume.
4. **"+ Comparar" on every chart**: overlay one or more other assets as lines. "Mi cartera" is one of the choices. While anything is compared, the price scale switches to **%** and every series starts at 0 % on the first visible day (lightweight-charts `PriceScaleMode.Percentage`, verified in the installed 5.2.0), so zooming or scrolling is the range.
5. **"Comparar con" sheet**: "Mi cartera" (when not the main chart), quick picks SPY, QQQ, DIA, EEM, VT, MERVAL (USD CCL), and a search for any other ticker (existing `/api/ticker/search`). Each comparison shows in a legend with its color and value, with × to remove it. The choice is remembered.

## Non-goals

- No candles, no volume, no intraday for Mi cartera.
- No ONs, cash or crypto in the portfolio line: it is the `stocks` universe (stocks + CEDEARs together).
- No changes to Estadísticas.

## Anti-goals (would be a failure even if it works)

- Counting deposits as gains. The portfolio series MUST be the flow-adjusted TWR (`computeUniverseTwr(..., 'stocks', ...)`), the same number Estadísticas shows, never raw value.
- Comparing in different currencies. Every compared series is in USD; an ARS-quoted symbol (`.BA`, `^MERV`) is divided by that day's historical CCL as `src/lib/benchmark.ts` does. While comparing, an ARS-quoted **main** chart is converted the same way, so its % is in USD too.
- Breaking existing charts and lists: with nothing compared, every chart, timeframe, indicator, drawing and list behaves exactly as today.

## Decided by the user

Everything in Goals, including the mockup's four frames for the list, "line not candles" for Mi cartera, compare on any chart between any assets, % scale while comparing, all in USD.

## My calls (the user has not weighed in; flag if wrong)

- **Mi cartera's values are an index starting at 100** (TWR index × 100): "what 100 USD invested on day one is worth today", read like a price. In % mode it becomes the cumulative return.
- **Mi cartera is daily only**; the timeframe menu offers just 1D for it (a third data source next to `yahoo` and `binance` in `src/lib/chart/timeframes.ts`).
- **Comparisons work on 1D, 1S (1w) and 1M charts only.** On intraday timeframes the compared lines are hidden and the legend says "Las comparaciones se ven en diario, semanal o mensual". Intraday CCL and intraday portfolio values don't exist; daily covers "compara rendimientos".
- **Compared series come from one server endpoint as daily USD closes** (Yahoo via `getBars`; crypto `XXXUSDT` maps to Yahoo `XXX-USD`; Mi cartera from the TWR). On weekly/monthly charts each bar takes the last daily close inside it, so the lines sit on the main chart's bar times.
- **Comparisons are remembered per device** (`useChartStore`, like the local watchlist), as one list shared by every chart, not per symbol. Default the first time: none on a stock; SPY when opening Mi cartera with nothing compared. Max 5.
- **A comparison equal to the main symbol is skipped.**
- **The "Mi cartera" row shows today's change of the stock portfolio**: the market-value-weighted `day_change_pct` of the positions `getPortfolio()` already loaded, so the list makes no extra request.

## Constraints and pointers from the code

- **Watchlist plumbing:** `activeWatchlistId` in `src/lib/store/chart-store.ts` is `null` for "Lista local" and a uuid for server lists. `Watchlist.tsx` (fetch effect, `handleRemove`) and `addSymbolToCurrentWatchlist` in `src/lib/warren/watchlist.ts` treat any non-null id as a uuid: a Cartera sentinel id needs a check in each so it never reaches `/api/watchlist`. No database change.
- **Selected symbol:** the store's `symbol` drives `TradingChart` (`src/app/trading/page.tsx`); Mi cartera needs a sentinel symbol. `?symbol=` deep links keep winning.
- **Candles:** `useCandles(symbol, timeframe)` (`src/components/trading/chart/useCandles.ts`) picks Yahoo or Binance by `getProviderForSymbol`; Mi cartera needs a third branch. `TradingChart` creates one `CandlestickSeries` (line ~243); Mi cartera needs a `LineSeries` there instead, with indicators still fed from closes.
- **Server data:** `/api/statistics` is heavy and only accepts the `BENCHMARKS` whitelist. A new, lighter endpoint returns daily USD series for N arbitrary symbols plus Mi cartera. Reuse the statistics route's TWR inputs (derived snapshots, external flows, declared transactions + income, `ledgerFlows`) and `getBars` (any Yahoo symbol, never throws). Validate symbols at the boundary (format, count). A symbol with no bars is a per-symbol error, not a failed request.
- **Symbol search:** `SymbolSelector` in callback mode (`setSymbolDialogOpen(true, onSelect)`) always calls `setSymbol` first, which would switch the main chart; no production code uses callback mode today, so it can be changed to call only the callback.
- **Phone first:** 320 px with no horizontal scroll; the Comparar sheet uses `ChartSheet`. Spanish UI copy.
- **Repo rules:** tests first (vitest); never `next build` in the workspace; probes in `mktemp -d` clones.

## Left to the builder

Endpoint name and response shape, component split, line colors (from the chart theme), how the legend coexists with the existing chart legend, loading and empty states (no holdings → the Cartera list says so; no snapshots → Mi cartera says there is no history yet), and caching (the statistics route uses 300 s under `statistics:v4:{uid}:*`, which `invalidateUserCache` already clears).
