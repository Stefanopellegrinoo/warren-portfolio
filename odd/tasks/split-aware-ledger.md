# Split-aware ledger: trades as traded, splits applied everywhere
Branch `feat/split-aware-ledger` (from `master` 4ce93a3). Delivery: ask-on-risk → `feature-branch-chain` (cached from nucleo-ledger, user 2026-10-22 "la 1"): chained PRs on the feature branch, one per stage; only finished, tested work reaches `master`. Runner: vitest (`npm test`, `npm run type-check`).

## Specs

- S1 (symptom): "Hay algo raro, mira acá" (Gráfico → Mi cartera, range "Todo": the line jumps to +300 % in 2022 and spikes in 2023 while SPY/QQQ are normal) → Mi cartera "Todo", the Resumen history and the since-inception statistics (TWR, drawdown) show no split jumps for the user's account.
- S2 (every user): "Y esto como queda para futuros usuarios que usen la app? Quiero que quede bien hecho, si lo que está mal son mis datos es otra vosa" → one rule: a trade is stored as traded (the quantity and price of the broker ticket that day). Every computation adjusts earlier trades by the splits after them: holdings, average cost, realized P&L, sale validation (TypeScript and SQL), history, statistics, trade markers. A sale after a split of shares bought before it is accepted.
- S3 (the user's data): same quote, "si lo que está mal son mis datos es otra vosa" → the user's 9 pre-split rows (stored split-adjusted) are converted once to as traded, after a backup in schema `backup`, by a migration the user pastes in the SQL Editor; verified with SELECT.
- S4 (guard, design call, assumption): with S2, a pre-split trade entered with split-adjusted numbers would now create phantom shares (×20 for GOOGL). A create, edit or import whose date is before a split of its ticker (cumulative factor ≥ 1.5) and whose price is closer to that day's adjusted close than to its real close is rejected with a message giving the as-traded values. When the day's close is unavailable the check is skipped, never blocking.
- S5 (display, design call): a trade before a split shows what was traded and, below, what it equals today ("Tras el split 20:1 del 18/07/2022: 18,62 a 129,58") in Historial and in the chart trade cards.

Assumptions: Yahoo `chart().events.splits` is the split source. A split applies at the start of its date: a trade on the ex-date is already on the new basis. CEDEAR rows store underlying shares (`quantity = trade_quantity / cedear_ratio`), so the underlying split factor applies unchanged; CEDEAR ratio changes not caused by an underlying split are out of scope. `.BA` (ARS) tickers get splits but no S4 price check (bars are in ARS, engine price in USD).

## Design

- **Market data:** table `stock_splits (ticker, date, numerator, denominator, yahoo_symbol, source, fetched_at)`, PK `(ticker, date)`, keyed by the ledger ticker (upper, trimmed). Written only by the worker (service role); RLS on, no direct reads for `anon`/`authenticated` (049 pattern). A `SECURITY DEFINER` function `split_factor(ticker, after date)` returns the product of `numerator/denominator` for splits dated after `after` and is granted to `authenticated`.
- **Worker:** job `splits-ingest`, weekdays 12:30 and 20:30 UTC plus once at startup: distinct non-ON tickers in `transactions` → Yahoo symbol (catalog, else `normalizeTickerForYahoo`) → `chart()` splits since the ticker's first trade; inserts only rows not already stored, then deletes the Redis splits key and invalidates the caches of the users who traded that ticker.
- **Reads:** one loader returns `Map<ticker, SplitEvent[]>` from Redis (`splits:v1`, whole table), else the table, through the service client. An unreadable table fails loudly like the other ledger inputs.
- **Core:** `ledgerAt` takes `options.splits`; each split up to the cutoff is an event ranked before that day's trades: quantity × n/d, cost basis unchanged, average cost recomputed, peak scaled. One change covers holdings, realized P&L, cash, multicurrency and the TS oversell check.
- **History:** `derived-series` keeps raw (un-adjusted) bars and passes the same chart splits to the core, so quantity and price are on the same basis each day.
- **SQL:** `process_transaction_atomic` re-checks the total held in today's share basis: `SUM(quantity × split_factor(ticker, date)) − |p_quantity| × split_factor(ticker, p_date)`.
- **Removed:** the unused lots FIFO (`calculatePositionLotsDefinition`, `/api/positions/[ticker]/lots`) if no caller exists, instead of making a second ledger split-aware.

Production order: 053 (table + function + RPC) → deploy (worker fills the table) → 054 (backup + convert the 9 rows) → invalidate the user's caches.

## Tasks

- T1 S2 — `ledgerAt` applies splits (pure, tests first) — inline — pending
- T2 S2 — migration 053 (`stock_splits`, `split_factor`, split-aware RPC check) + worker `splits-ingest` + splits loader — inline — pending
- T3 S1,S2 — wire splits into ledger-now, ledger-write oversell and derived history; drop the lots FIFO if unused — inline — pending
- T4 S4 — reject split-adjusted pre-split prices on create, edit and import — inline — pending
- T5 S5 — "Tras el split" line in Historial and trade cards — inline — pending
- T6 S3 — migration 054: backup + convert the user's 9 rows; verify by SELECT; invalidate caches — inline (user pastes) — pending
- T7 S1 — end-to-end check on the user's account (Todo, Resumen history, statistics) — inline — pending

Route evidence: no Writer trigger (units are sequential and depend on T1), so every task is inline. Forecast ≈ 780 authored lines → chained PRs.

## Log

- L1 (2026-10-26) "Hay algo raro, mira acá" → diagnosed: `derived-series.ts:316` un-adjusts Yahoo bars assuming as-traded quantities, while the user's old trades are stored split-adjusted; nothing else in the app handles splits.
- L2 (2026-10-26) "Y esto como queda para futuros usuarios que usen la app? Quiero que quede bien hecho, si lo que está mal son mis datos es otra vosa" / "lo quiero hacer en una sesion nueva, cerremos bien esta"
- L3 (2026-10-26) "carga contexto para seguir" / "hacelo con odd" → ODD started. Explorer map: every holdings/cost/realized/oversell computation goes through `ledgerAt` (`ledger-core.ts:145`); the SQL RPC `process_transaction_atomic` (046:112-119) re-checks raw `SUM(quantity)`; trade markers place by date only; no corporate-action table exists. DB check (SELECT): the 9 rows are GOOGL 2022-03-21 ×2, TSLA 2022-03-02 and 2022-03-31, NVDA 2022-05-05 ×2, 2023-06-29, 2023-08-02, SONY 2023-09-01, all `ACCION`, `trade_*` = engine values; every later row is as traded.
- L4 (2026-10-26) Follow-up outside scope (explorer): `PnLSidebar.tsx:97` shows CEDEARs as `quantity / ratio` while the engine stores `trade_quantity / ratio`; to check separately.
