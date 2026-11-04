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
| T1 | S1 | inline | done, verified | commit 1d726c9; `extendedHours` 5 tests, provider 2, route 2 (+1 updated) RED → GREEN; live: VST pre 127,96 −8,32 %, SPY, MELI, GGAL pre before the open |
| T2 | S2 | delegated writer (parallel with T3) | done, verified | commit 6738181; 14 tests RED → GREEN (line options on 1d and 15m, price in place, removed on null, Pre → Post, symbol switch, legend "+3,00 %Pre 130,00 −6,86 %", line kept while comparing, theme amber, `useQuote` fraction and crypto null, page passes it); "none" cases proven by breaking the gate; browser L6 |
| T3 | S3, S4 | delegated writer (parallel with T2) | done, verified | commit 97ef36a; `nextSort`/`sortSymbols` 7, store 2 (old saved state loads), Watchlist sort/Ext flow RED → GREEN; width check 220–640 px; browser L6 |
| T4 | S1–S4 | inline | in progress | full suite 3841 pass after the parallel units (seam check); browser L6 |

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
- L6 Outcomes (2026-11-04). Seam check: suite 3841 pass, `tsc` clean, lint 0 errors (warnings are the base's). Browser (disposable page, real Yahoo quotes before the open, real VST bars): the 1D chart shows the amber "Pre 127,10" axis label and the legend "Pre 127,10 −8,94 %"; the list at 420 px sorted by Ext, highest first: MELI +2,41, SPY +0,96, GGAL +0,22, NVDA −0,92, TSLA −4,37, VST −8,94, then BCBA:GGAL and BTC with "—"; on a 390 px phone the second click reverses it; no horizontal scroll. Writer calls: the line also needs the chart's bars to be this symbol's (`fresh`), so no wrong line flashes after a switch; while comparing in %, its axis label reads in % like every other label; on a phone the legend text shows only while a finger is on the chart (the day % does too), the axis label always; the price column with the "1 mes" line went 96 → 80 px to fit Ext; a remembered Ext sort is ignored while the column is hidden. Open decision for the owner: "Ext" needs 375 px, so the desktop list at its default 280 px does not show it (the phone always does: the list is full width there). Follow-up noted, not built: the price scale does not stretch to the extended price, so a gap larger than the visible range leaves the line off screen.
