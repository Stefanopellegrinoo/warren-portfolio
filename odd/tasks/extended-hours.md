# Extended hours: pre-market and post-market like TradingView

Objective: show the pre-market and post-market price on the chart and in the Gráficos watchlist, as TradingView does, and let the watchlist be sorted by its columns. Branch `feat/extended-hours` from `master` 1c67912; delivery `single-pr` (the owner merges each feature as one squash PR).
Runner: vitest (`npm test`), `npm run type-check`, `npm run lint`; a browser check with real Yahoo quotes; the full suite once as the seam check after the parallel units.

## Specs

- S1 Every Yahoo quote carries its extended-hours price. L1: "quiero agregar post y pre mercado, como hace trading view"; L2: "ver cómo se mueve la acción antes de que abra". Acceptance: `/api/quote` returns, per ticker, the extended session (`pre` or `post`), its price and its % against the regular close, from Yahoo's `preMarket*` / `postMarket*` fields; the session shown is the one traded after the regular session's last trade (the later one when both are), so it is none during the regular session; none for Argentine stocks (`BCBA:`), crypto (Binance) and Mi cartera; the existing fields are unchanged.
- S2 The chart shows it as TradingView does. L3: "mira [Image #16] fiajte lo que subraye con la liena roja, asi quiero, como hace tradingview" (the screenshot: an orange "Pre 130,60" label on the price axis of a daily chart); L4: "me gusta" on the mockup. Acceptance: on every timeframe, a dashed orange price line at the extended price with its axis label, titled "Pre" or "Post"; the legend reads "Pre 130,00 −6,86 %" (or "Post …") next to the day's %; nothing when there is no extended price; it follows the quote poll (15 s) and leaves no line behind when the symbol or the session changes.
- S3 The Gráficos watchlist has an "Ext" column. L3 (the screenshot's underlined "Ext" column) and L4. Acceptance: a column headed "Ext" with each row's extended-hours %, green when up and red when down, "—" when there is none; the other columns unchanged.
- S4 The watchlist sorts by its columns. L4: "tambien agrega que en la columnas se pueda agregar por orden" (read as: sort by clicking a column header, as the Mercado table does; the owner was told this reading). Acceptance: clicking "Símbolo", "Precio", "Var. día" or "Ext" sorts the list by it; the first click sorts A→Z for Símbolo and highest first for numbers, the second reverses, the third goes back to the list's own order; the header shows the active column and direction (also as `aria-sort`); rows without a value go last; Mi cartera stays on top; the choice is remembered on the device for every list (assumption: one sort for all lists).

## Tasks

| ID | Specs | Route | Status | Evidence |
|----|-------|-------|--------|----------|
| T1 | S1 | inline | pending | |
| T2 | S2 | delegated writer (parallel with T3) | pending | |
| T3 | S3, S4 | delegated writer (parallel with T2) | pending | |
| T4 | S1–S4 | inline | pending | |

- T1 Quote data: Yahoo `getQuote` asks for `marketState`, `preMarket*`, `postMarket*`; a pure helper picks the session; `/api/quote` returns it as `extended`.
- T2 Chart: `useQuote` carries `extended`; the trading page hands it to `TradingChart`, which draws the price line and the legend text.
- T3 Watchlist: the "Ext" column from `/api/quote`'s `extended`, and sortable headers remembered in the chart store.
- T4 Seam check (full suite), browser check with real quotes on desktop and phone widths, outcomes.

Route evidence: T2 and T3 are independent units with disjoint files (chart: `useQuote.ts`, `trading/page.tsx`, `TradingChart.tsx`; watchlist: `Watchlist.tsx`, `chart-store.ts`), each several files, both on top of T1: Writer trigger (a), launched together.

## Log

- L1 (2026-11-04, user): "quiero agregar post y pre mercado, como hace trading view"
- L2 (2026-11-04, user, asked what they look for in TradingView): "ver cómo se mueve la acción antes de que abra"
- L3 (2026-11-04, user, with a TradingView screenshot): "mira [Image #16] fiajte lo que subraye con la liena roja, asi quiero, como hace tradingview"
- L4 (2026-11-04, user, on the mockup `pre-mercado.html`: dashed "Pre" line, legend "Pre 130,00 −6,86 %", "Ext" column): "me gusta, hacelo con odd y tambien agrega que en la columnas se pueda agregar por orden"
- L5 Recon. Yahoo's `quote()` returns `marketState`, `preMarketPrice/ChangePercent/Time`, `postMarketPrice/ChangePercent/Time` (checked live before the open: VST pre 129,88 −6,95 %, last evening's post 139,68); nothing in `src` reads them. `getQuote` passes a `fields` whitelist (`providers/yahoo.ts:170`); `/api/quote` caches the whole `Quote` 15 s (`route.ts:54`), no strict schema on the path; clients: `Watchlist.tsx:152`, `useQuote.ts:21`; `/api/watchlist` reads only price and %. The trading page's one quote poll is `useQuote` (`trading/page.tsx:42`); `TradingChart` gets no quote. Watchlist order is the list's own (insertion) order; its header row is plain text (`Watchlist.tsx:224`). Mercado's sort lives in `market-view.ts:84` (typed to its rows) and `MarketTable.tsx:59` (`SortButton`, not exported). Yahoo's extended-hours chart bars have volume 0 (no change here).
