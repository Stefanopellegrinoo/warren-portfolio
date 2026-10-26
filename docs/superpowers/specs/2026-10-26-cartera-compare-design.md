# Cartera list and portfolio-vs-ETF chart — design

Date: 2026-10-26. Mockups the user approved ("Está bien"): https://claude.ai/artifact/UUQAngYDu6vUuZ9d4KR8cV

## Intent

The user's words: "Que una lista por defecto sea la cartera de acciones y que se pueda hacer gráfico para comparar contra otros activos a elección". What they compare: "Compara rendimientos, contra etfs". Where: on the Gráfico page, "como lo de estadísticas pero mucho mejor hecho en gráficos".

Today the only portfolio-vs-benchmark view is the small recharts chart in Estadísticas (`src/components/charts/BenchmarkComparison.tsx`), with three fixed choices (MERVAL CCL, SPY, QQQ) and no range. The user wants the same answer — "is my stock portfolio beating the market?" — in the place they already live every day (the Gráfico page of the iPhone PWA), with the feel of the trading chart and any ETF they pick.

## Goals

1. **A "Cartera" list, always first** in the Gráfico lists menu (`WatchlistSelector`), above "Lista local". Nobody creates it; it shows the stocks and CEDEARs held right now (`getPortfolio().positions`). Buying a new one adds it; selling all of one removes it. It cannot be renamed, deleted, or edited by hand (no add, no remove buttons).
2. **"Mi cartera" row on top of that list** (subtitle "Rendimiento de las acciones"), then one row per held ticker. Tapping a ticker opens its normal candle chart, with trade arrows, exactly as from any other list.
3. **Tapping "Mi cartera" shows a % line chart instead of candles**: the stock portfolio's return and each chosen comparison, every line starting at 0 % on the same day. Legend shows each line's name, color and value at the end of the range (or at the crosshair), with × to remove a comparison. Ranges: 1M, 3M, 6M, YTD, 1A, Todo. The header reads who is ahead over the chosen range.
4. **"+ Comparar" opens a "Comparar con" sheet**: quick picks SPY, QQQ, DIA, EEM, VT, MERVAL (USD CCL) as checkboxes, plus a search box for any other ticker (existing `/api/ticker/search`). The choice is remembered for next time.

## Non-goals

- No intraday: the comparison is daily only; the timeframe control is hidden in this mode.
- No drawing tools, indicators or alerts on the comparison chart.
- No ONs, cash or crypto in the portfolio line: it is the `stocks` universe (stocks + CEDEARs together; there is no CEDEAR-only universe and none is wanted).
- No changes to Estadísticas.

## Anti-goals (would be a failure even if it works)

- Counting deposits as gains. The portfolio line MUST be the flow-adjusted TWR (`computeUniverseTwr(..., 'stocks', ...)`), the same number Estadísticas shows, never raw value.
- Comparing in different currencies. Everything is USD; MERVAL is `^MERV` divided by the historical CCL, as `src/lib/benchmark.ts` already does.
- Breaking existing lists: "Lista local" and server lists must behave exactly as today.

## Decided (by the user, via the approved mockups)

The four frames above: automatic Cartera list first, Mi cartera on top, % lines from 0 with the six ranges, + Comparar sheet with those six quick ETFs plus search, remembered choice, same TWR as Estadísticas, USD, daily only.

## My calls (the user has not weighed in; flag if wrong)

- **Default comparison the first time:** SPY alone.
- **Max 5 comparisons** at once, so the chart stays readable on a 320 px phone.
- **"Remembered" means on this device** (persisted in `useChartStore`, like the local watchlist), not synced to the account. Syncing would need a new section in `chart_preferences` plus a migration; add it only if the user asks.
- **Rendering with lightweight-charts** (the library of the trading chart) `LineSeries` in percentage format, not recharts — that is what "mucho mejor hecho en gráficos" points to: same crosshair, pinch/scroll and look as the candle chart.
- **Range re-basing on the client:** the server returns the full series from the first common date; the client re-bases each line to 0 at the range start with `(1 + p) / (1 + p0) − 1`.
- **Peso-quoted picks are converted, not refused:** any symbol quoted in ARS (Buenos Aires `.BA` tickers, `^MERV`) is divided by the historical CCL like MERVAL is in `src/lib/benchmark.ts`, so every line stays in USD. The endpoint decides the currency per symbol (exchange suffix, or Yahoo metadata).
- **The number on the "Mi cartera" row is today's change of the stock portfolio**, the market-value-weighted `day_change_pct` of the held positions already loaded by `getPortfolio()`, so the list needs no extra request and matches the daily % on the ticker rows.
- **"Todo" starts at the first date where the portfolio TWR and all chosen comparisons have data.** A ticker with shorter history shortens "Todo"; it does not leave a gap.

## Constraints and pointers from the code

- **Watchlist plumbing:** `activeWatchlistId` in `src/lib/store/chart-store.ts` is `null` for "Lista local" and a uuid for server lists. Several call sites treat any non-null id as a server uuid (`Watchlist.tsx` fetch effect and `handleRemove`, `addSymbolToCurrentWatchlist` in `src/lib/warren/watchlist.ts`). A sentinel id for Cartera needs a check in each, so it never reaches `/api/watchlist`. No database change is needed for the list.
- **Selected symbol:** `src/app/trading/page.tsx` renders `TradingChart` with the store's `symbol`. "Mi cartera" needs its own sentinel value there, so the page renders the comparison chart instead of `TradingChart`; `?symbol=` deep links keep working.
- **Server data:** `/api/statistics` computes everything (heavy) and only accepts the `BENCHMARKS` whitelist (SPY, QQQ, MERV_CCL). A new, lighter endpoint is needed that returns the `stocks` TWR series plus daily bars for N arbitrary symbols. Reuse the same inputs as the statistics route (derived snapshots, external flows, transactions, income) and `getBars` (`src/lib/bars-cache.ts`, any Yahoo symbol, never throws). Validate symbols at the boundary (format + count) and auth as the other APIs do. A symbol with no bars returns a per-symbol error, not a failed request.
- **Holdings:** `getPortfolio()` (`src/lib/warren/positions.ts`, client-cached) gives `positions` = stocks + CEDEARs, charted under their plain ticker.
- **Symbol search:** `SymbolSelector` in callback mode (`setSymbolDialogOpen(true, onSelect)`) always calls `setSymbol` before `onSelect`, which would switch the main chart. Either guard that or reuse only the search request in the Comparar sheet.
- **Phone first:** works at 320 px with no horizontal scroll; the Comparar sheet uses `ChartSheet` (bottom sheet under 820 px, dialog above). Spanish UI copy.
- **Repo rules:** tests first (vitest), no `next build` in the workspace, probes in `mktemp -d` clones.

## Left to the builder

Endpoint name and response shape, component split, colors per line (from the chart theme), empty and loading states (no holdings → the Cartera list shows an empty message; no snapshots → the chart says there is no history yet), how the legend handles the crosshair, and caching (the statistics route uses 300 s; something similar is fine).
