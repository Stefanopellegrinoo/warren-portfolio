# UX project 3: page by page

Objective: every page tells the user what happened (errors, saves, deletes), confirms destructive actions inside the app, uses Argentina dates, and shows the important numbers first on phones.
Branch `feat/ux-pages` from master 165bb7b. Delivery: stacked to master, as in projects 1 and 2 (confirmed with the user at PR time). Tests: vitest (`npx vitest run`), `npx tsc --noEmit`, `npm run lint`.

## Specs

- S1 Errors are never silent: "Muy importante también que el usuario entienda bien cuando hay un error o qué pasó." Every failed save, delete or toggle shows a Spanish message (toast or inline, next to what failed). A failed load says it failed, with Reintentar, and never looks like an empty list ("La lista está vacía.", "Todavía no hay movimientos de caja.", "No hay señales para los filtros elegidos." are shown only when the load succeeded and is empty). A refresh that fails while older numbers are on screen says the numbers may be outdated. A request that never reached the server shows `NO_CONNECTION` ("No hay conexión. Revisá tu internet y probá de nuevo."), never the browser's "Failed to fetch". A button that sends a request is disabled while it is in flight.
- S2 Saves and deletes confirm: "También quiero que te fijes en los detalles, en formularios, en las alertas". Each save, delete or toggle that succeeds shows a short success toast (`toast.success`, as in `AddTransactionModal`), unless the page already shows the result in place (as `AdjustCashDialog` does).
- S3 Destructive actions confirm inside the app: no native `confirm()`. Use `InlineConfirm` (`src/components/ui/InlineConfirm.tsx`) next to the action, with the question and a specific confirm label (e.g. "Sí, borrar"), keeping today's question text.
- S4 Dates in Argentina time: the default date of a new expense is today in Argentina (`argentinaDate()`, `src/lib/utils.ts`), even after 21:00; an expense due today is not "Vencido" until the day is over in Argentina (client list and the server `overdueCount`); date-only values (`YYYY-MM-DD`, e.g. statistics `close_date`) never show the previous day.
- S5 Wide tables on phones: "para mostrar la información más importante, para no saturar al usuario". The strategy performance tables (comparison, 8 columns; paper trades, 9 columns) read on a phone without horizontal scrolling: a card list below 1080px with the key values, the full table from 1080px (as `ExpenseList` and `OnExplorerTable` do).
- S6 Statistics shows the headline first: total portfolio value and the KPIs come before the benchmark comparison and the evolution chart. A failed load has Reintentar; a tab whose data failed says so instead of rendering only part of the page.
- S7 No English or raw technical text reaches the user: malformed JSON in a request body answers 400 with `INVALID_JSON` (not 500) for every route that uses `validateRequest`; the `ons/search` message is Spanish; dead English code in `src/lib/auth-utils.ts` (`ERROR_RESPONSES`, `createAuthErrorResponse`, `validateUserSession`, `createAuthSuccessResponse`, no callers) is removed.
- S8 (decision pending, asked at the end) How price alerts reach the user: they are sent only by Telegram, and `sendTelegram` skips silently when `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` are missing.
- S9 (decision pending, asked at the end) "Olvidé mi contraseña": no reset flow exists; it needs a Supabase email setting and the PWA opens email links in Safari, outside the app's storage.

Skipped: `viewport-fit=cover` and safe-area insets. The user tested the installed PWA on the iPhone ("todo perfecto"), so there is no reported problem to fix; add when one shows up.

## Tasks

| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T0 Shared helpers: `InlineConfirm`, `requestErrorMessage` | S1, S3 | inline | | |
| T1 Gastos: toggle/delete errors and busy state, success toasts, in-app delete confirm, Argentina dates | S1-S4 | delegated (parallel unit) | | |
| T2 Gráficos: watchlist load/remove/add errors and toasts, chart alert remove toast, in-app "borrar dibujos" confirm, chart and search errors in Spanish | S1-S3 | delegated (parallel unit) | | |
| T3 Estrategias: in-app setup delete confirm, performance tables as cards on phones, load errors with retry, connection errors in the forms | S1, S3, S5 | delegated (parallel unit) | | |
| T4 Estadísticas: headline first, retry, per-tab failures, close dates | S1, S4, S6 | delegated (parallel unit) | | |
| T5 Resumen and Historial: refresh failure notice, movement delete errors/toast/confirm, movements load error, history delete confirm and toast, CEDEAR fix toast | S1-S3 | inline | | |
| T6 Messages: `validateRequest` invalid JSON, `ons/search`, dead auth-utils code, connection errors in AddTransactionModal and review-fix | S1, S7 | inline | | |
| T7 Integration sweep (13 widths × 2 themes) and full suite | all | inline | | |

Route evidence: T1-T4 are four independent units with disjoint edit surfaces (cashflow, trading, strategies, statistics), each with several files and 100+ changed lines, launched together; T0 lands first so they reuse it. T5-T6 are small and run inline while the writers work.

## Log

- L1 (2026-10-23, user, project 1 request, verbatim in `odd/tasks/ux-base-global.md` L1): "...También quiero que te fijes página por página y que uses la cabeza, que sigas patrones de diseño, buenas prácticas, todas esas cosas para mostrar la información más importante, para no saturar al usuario... También quiero que te fijes en los detalles, en formularios, en las alertas y toda la experiencia de usuario. Muy importante también que el usuario entienda bien cuando hay un error o qué pasó."
- L2 (2026-10-24, user, after testing projects 1 and 2 in production on the iPhone): "todo perfecto segui"
- L3: map from a read-only explorer (path:line evidence in Engram, topic `odd/ux-paginas/tasks`): silent failures in cashflow, watchlist, dashboard refresh, movements, strategy performance, statistics; 5 native `confirm()`; UTC dates in cashflow and statistics; strategy tables 820-920px wide; statistics headline after the charts and no retry; `validateRequest` turns malformed JSON into 500; no password reset; price alerts only by Telegram, skipped silently when not configured.
