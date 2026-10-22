# Prices in real time and the portfolio in three currencies

Date: 2026-10-22. Status: approach approved by the user ("Ok"); stage A in progress.

## Why

The user, verbatim:
- "quiero bajar el tiempo de recarga de 5mims al mínimos posible, si se puede tiempo real mejor. Para el Dashboard y el gráfico."
- "quiero hacerlo bien como lo hacen los brokers. En argentina todo esto es un quilombo, porque podes comprar activos con dólares, pesos o cable. … quiero poder mostrar al usuario el monto en los 3. Pero para eso es el usuario tiene que poder cargar bien a cuánto lo compró o vendió, y eso depende de cómo lo compró y el dólar q se usó"

The user approved this summary of the solution:
1. Load a trade the way the broker ticket shows it.
2. Show the portfolio in Pesos / MEP / Cable.
3. Refresh prices every ~30 s instead of every 5 min.
4. Convert the trades already loaded approximately, and flag the ones to review.

## What exists today (measured 2026-10-22)

- **CEDEAR storage.** A CEDEAR trade is stored as the underlying US ticker. `quantity = cantidad / ratio`; `price = precio × ratio / CCL`, or `precio × MEP × ratio / CCL` when it was entered in USD (`AddTransactionModal.tsx:512-557`).
  - The raw price, the raw CEDEAR count, the ratio and both FX rates are discarded.
  - Both FX rates come from `dolarapi.com` live **when the modal opens**, not from the trade date.
- **`transactions.moneda`.** It exists, but no engine reads it. Every engine assumes one USD unit.
- **Valuation.** CEDEARs are valued with Yahoo US quotes.
- **Refresh chain.**
  - The worker refreshes prices every 5 min, from 10:30 to 18:00 AR.
  - Redis `summary:{userId}` has TTL 600 and is written only by the worker.
  - The Dashboard polls every 300 s.
  - The chart polls `/api/quote` every 60 s, uncached (one Yahoo call per request).
- **FX history.** None is stored. CCL is derived from GGAL and cached in Redis.

## Research (sources in the session log; V = verified)

- **Cocos (V).** Shows ARS or USD, with no cable view. It converts holdings in the other currency with that day's closing MEP (average of buy and sell). Its average purchase price (PPC) is a moving weighted average: a partial sale leaves it unchanged, and a full close resets it. It says the ARS and USD results "may not match".
- **BYMA lines.** Each asset has three lines: pesos (`AAPL`), MEP (`AAPLD`) and cable (`AAPLC`).
  - Implied FX differs per asset because the books differ; AAPLC is very thin (volume 155 vs 20,279 for AAPLD).
  - data912 `/live/arg_cedears` serves all three lines, with Cloudflare `max-age=30`.
- **FX history.** argentinadatos.com has daily MEP (`/v1/cotizaciones/dolares/bolsa`) since 2018-10-29 and CCL (`/contadoconliqui`) since 2013-01-02.

## Goals

1. **Real time (stage A).** During market hours the Dashboard and the chart show prices at most ~30–60 s old.
2. **Faithful trade record (stage B).** A trade stores what the user did:
   - date;
   - currency it was settled in: `ARS` | `MEP` | `CCL`;
   - the instrument's own quantity (CEDEARs, not underlying shares) and price in that currency;
   - commission and its currency;
   - the CEDEAR ratio at that date;
   - the MEP and CCL of that date, each with a source: `reference` (argentinadatos close) or `user` (typed by the user).

   Nothing is recomputed later.
3. **Three views (stage C).** Every figure the Dashboard shows (value, cost, result, per holding and total) is available in Pesos, MEP and Cable. One selector switches between them.
4. **Existing trades.** Every existing trade is converted to the new record. Its original price is reconstructed approximately with the FX of the day it was **loaded** (`created_at`), because the old form used that day's live FX. A review list flags rows whose reconstruction is uncertain.

## Non-goals

- Implied FX per trade from the D/C lines (no history exists).
- Official rate (A3500) and crypto in three currencies.
- Tax calculation.

## Anti-goals

- A figure in one currency silently computed from another currency's figure without the FX of its date.
- Losing the user's typed values.
- The three results looking like an error. The UI says why they differ.

## Decided by the user

- The approach above, stages A → B → C.

## Decided by me (review)

- **Valuation today.** In pesos: quantity × peso-line price (data912 live). In MEP and cable: the ARS value ÷ that day's reference MEP / CCL. This is Cocos' method. Per-line D/C prices are not used for valuation because the C lines are too thin.
- **Cost.** Per lot in each currency, with FX of the trade date. One moving weighted-average PPC per currency, with Cocos semantics.
- **Realized result.** Dividends and coupons are converted at the FX of their payment date. CEDEAR dividends record the currency actually credited.
- **US stocks and the US-price view.** These keep Yahoo. The chart keeps showing the US ticker.
- **FX fallback.** A missing reference FX for a date (weekend, holiday) uses the previous available day, and the record says which date was used.
- **Real-time cadence.**
  - Worker every 60 s during market hours.
  - `/api/quote` cached 15 s in Redis.
  - Dashboard polls every 30 s.
  - Chart quote every 15 s; candles every 30 s.
  - data912 is never polled faster than its 30 s cache.

## Stages

- **A. Real time + FX history.** Shorter refresh chain; `fx_rates` table with a daily ingest and a backfill from argentinadatos. Deployable alone: no visible unit change.
- **B. Faithful trade record.** New columns on `transactions` (nullable at first); the new entry form; reconstruction of existing rows; review list. Deployable alone: the Dashboard keeps its USD view.
- **C. Three views.** Engines compute cost and value per currency. Live peso-line prices from data912 for CEDEARs and local stocks. Selector Pesos / MEP / Cable, with an explanatory note.

## Risks

- data912 is unofficial and has no SLA. Fall back to Yahoo US × reference CCL, labelled as estimated.
- Reconstructed historical trades are approximate (FX of load day, and parking lag before 2025-04-15).
- Migrating `transactions` is high risk, item 1 (stored data). It requires a backup, additive columns only, and the user's OK before applying.
