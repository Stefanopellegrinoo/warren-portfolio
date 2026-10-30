# Asset page: financial data for any asset

Objective: one clear page per asset (any asset the user searches), with its financial data, the history of every number, peers, news and a plain-language summary, as designed in `docs/superpowers/specs/2026-10-30-asset-page-design.md` (committed d58d871; mockups approved: `docs/superpowers/specs/assets/2026-10-30-asset-page-numeros-{mobile,desktop}.png`).
Branch: `feat/asset-page` (from `master` 45e0ba7). Delivery: ask-on-risk → `stacked-to-main` (user L10: "Por etapas a prod"). Forecast ~4,300 authored lines. Each finished, tested stage goes to `master` with the user's OK, as its own PR. Tabs not built yet stay hidden.
- Stage 1: T0–T6 (search + page + Números). Non-company assets show the header and price with a short message until T10.
- Stage 2: T7–T10 (Comparar, Noticias, Resumen, other assets).
- Stage 3: T11–T12 (Balances completos, SEC). Runner: vitest (`npm test`), `npm run type-check`, `npm run lint`; UI checked in headless Chromium at 11 widths (320–1920).

## Specs

The design document is the detailed specification; each S# below names its section there. Workers read the design document's sections named here, and this file until `## Log`.

- S1 A page per asset, findable for any asset. User (L1): "LO que mas me importa son los datos financieros y demas, como balances,etc, de cada uno de los activos, esto me parece fundamental, tiene que tener su pagina bien clara, en donde se entienda bien cada dato, que sea facil de entender, bien legible . Pero tambien quiero que se pueda buscar la info de cualquier activo que el usuario quiera." User (L2): "es lo mismo, cualquier activo. sus datos financieros, noticias, cualqueir cosa relevante que importa saber." Design: Goals 1, 2, 9 and "Which assets get a page". Acceptance: a search box in the app shell (`/` focuses it on desktop) and every ticker the app shows open the page; tabs Resumen · Números · Comparar · Noticias; listings outside TradingView's america/argentina markets show name and price with "Todavía no tenemos datos financieros de este mercado" and write no fundamentals keys; ONs/bonds go to `/ons/[isin]`.
- S2 For every reader. User (L4): "para cualquier usuario, que no sepa nada de balances, hasta gente mas avanzada". Acceptance: every metric row has its "?" explanation in plain Spanish with this company's value and its peers' (design Goal 3 example text); no jargon without one.
- S3 Números as approved. User (L8, desktop): "me gusta hacelo". Amended by L24: the app menu collapses to icons on the asset page (as on Gráficos) and nothing reads crowded; legibility first. Design: Goal 3 and "Metric catalog". Acceptance: the groups and rows of the catalog; mobile = list + "?" popover + tap → full-screen history with "‹ Números"; desktop = two-column list + sticky history panel; history panel = value with change vs a year earlier, 2/5/8 años, Trimestral/Últimos 12 meses/Anual, line chart with best point and hover value, "¿Qué es?", "¿Cómo viene?" (only what the numbers show), "Contra sus parecidas" bars; forward metrics, target, shares, float and employees have no chart.
- S4 History of every number. User (L5): "solo esos datos tenemos de las acciones? Quiero mas datos, tipo todos los financieros de los ultimos q de hace varios años para ver el cambio, lo mismop con los demas datos". Design: "One computation". Acceptance: group T metrics show up to 32 quarters / 20 years (TradingView), group Y up to 5 years / 6 quarters (Yahoo) with "historia desde <año>" when shorter.
- S5 One number, one meaning. Design: Goal 4 and "One computation". Acceptance: for any metric, the list value equals its chart's "hoy" point and every peer's value comes from the same source and function; a metric never mixes sources across periods or companies; ADR/foreign ratios use market cap (no per-share ADR ratio), foreign statements converted at each period end's FX.
- S6 The statistics the user asked for. User (L6, showing TradingView's Estadísticas): "todos estos datos podemos teneetr?". Design: "Metric catalog" (dropped: número de accionistas, valor liquidativo, VE/EBIT esperado).
- S7 Argentine companies in dollars. User's choice (L9): "Dólares CCL". Acceptance: amounts and their growth for ARS reporters are converted at the CCL of each period's end (app's CCL history); ratios are computed in USD at each date (L11 #1, L13), so BYMA ratios can differ from TradingView's nominal-peso ones; no ARS toggle; plain tickers of Argentine ADRs use the `BCBA:` listing for Números with the note "Datos de <empresa> en BYMA"; the IAS 29 question (as reported vs restated) is checked per source before converting.
- S8 Balances completos. User (L5) as S4. Design: Goal 5. Acceptance: link at the end of Números; Resultados / Balance / Flujo de caja tables, one row per line, one column per quarter or year, horizontal scroll inside the container only, ▲▼ vs the same period a year earlier, tap a row → its chart; per row one source (SEC for US 10-Q filers since ~2009, else Yahoo; TradingView rows for its eight lines in the 8-year range).
- S9 Comparar. User (L3): "si le está yendo bien como empresa y si está cara, ratios, capaz poder compararla con otras empresas". Design: Goal 6 and "Peers". Acceptance: company + up to 5 peers (same industry and market by market cap; filled from the US market when a BYMA industry has fewer than 3) on P/E, P/E esperado, crecimiento de ventas, margen neto, ROE, deuda/patrimonio, capitalización; edits live in `?vs=` and apply to the whole page.
- S10 Noticias. Design: Goal 7. Acceptance: Spanish first (Google News RSS es-419/AR), plus Yahoo English; newest first; de-duplicated by title; source and age; links out.
- S11 Resumen. User (L3) as S9. Design: Goal 8. Acceptance: "¿Le va bien como empresa?" and "¿Está cara?" stated from data, never as advice; 52-week range; analysts' average target and count; next earnings date and the last four quarters' estimate vs actual; sector · industry · country · employees.
- S12 Constraints. Design: "Constraints" and anti-goals. Acceptance: Redis only (no Supabase table or write); every key has a TTL and derives only from a ticker resolved by `resolveTickerIdentity` in a supported market, or from a symbol TradingView itself returned (default peers, L13); normalized payloads ≤ ~30 KB per company per source; per-user rate limit on the new routes; each section degrades on its own and serves its last good data; responsive 320–1920 with no horizontal page scroll; app tokens light/dark, IBM Plex, Spanish number format; no personal portfolio data in repo, tests, commits or PRs.

## Tasks

Routes: the parent session is past the ~150k context backstop, so implementation tasks go to bounded writers (Writer trigger b); T1 and T2 have disjoint surfaces and several minutes of work each, so they run in parallel (Writer trigger a) on the shared contract `src/lib/fundamentals/types.ts` written inline by the parent (T0).

- [x] T0 · S5 · inline · shared contract `src/lib/fundamentals/types.ts` (Series, Market, AssetRef)
- [x] T1 · S4 S5 S6 S9 · delegated (parallel with T2) · TradingView source: today's catalog values, `_fq_h`/`_fy_h` history with period ends, peers by industry · 19 tests (RED first, 7 mutations caught)
- [x] T2 · S4 S5 S7 · delegated (parallel with T1) · Yahoo source: normalized statements (quarterly/annual), profile, currency; FX at period ends (Yahoo FX for foreign, app CCL for ARS) · 18 tests (RED first); IAS 29 probe in L11
- [x] T3 · S3 S4 S5 S6 · delegated · pure metrics module: catalog definitions, today + history per metric, peers, group T/Y source rule · 20 tests (RED first, 15 mutations caught) + ADR units fix inline (L12)
- [x] T4 · S1 S12 · delegated · service + API route: ticker validation and market check, Redis cache with TTLs and last-good fallback, rate limit, per-section errors · 23 tests (RED first, 9 mutations caught), live smoke MELI/GGAL/TSM
- [x] T5 · S1 · delegated · page shell `/activo/[ticker]`, header, tabs, shell search with `/`, links from every ticker · 112 tests in touched dirs, full suite 3397 green (6 mutations caught)
- [x] T6 · S2 S3 · delegated · Números UI (mobile + desktop), "?" copy, history panel, peers bars · 23 new tests (RED first); browser at 11 widths light/dark, no horizontal scroll
- [x] T6e · S3 S12 · delegated · collapsed icon menu on /activo + layout and legibility pass at every width (L24) · 3448 tests green; 0 wrapped labels 820–1920

  Stage 1 delivered: PR #49, squash 73ff07d, deploy run 41081377001 OK (L27).
- [x] T7 · S9 · delegated · Comparar tab · 15 tests (RED first); browser 6 widths × light/dark (L29)
- [x] T8 · S10 · delegated · Noticias · 34 tests (RED first, 6 mutations caught); live MELI/GGAL/TSM/YPFD ok (L28)
- [x] T9 · S11 · delegated · Resumen + tab wiring · 3535 tests green; browser 4 tickers × 4 tabs × 6 widths × 2 themes (L30)
- [x] T10 · S1 · delegated · ETFs, crypto, ON redirect, unsupported markets, target consistency · 3564 tests green; browser 4 × 4 widths × 2 themes (L31)
- [x] T11 · S8 · delegated · Balances completos (Yahoo + TradingView rows) · 40 tests (RED first, 9 mutations); browser 3 tickers × 4 widths × 2 themes × 6 views (L36)
- [x] T12 · S8 · delegated · SEC source for Balances completos (US 10-Q filers) + EPS in US$ · 41 tests (RED first, 8 mutations); live MELI/NVDA/TSM (L37)

## Log

- L1 (2026-10-29) User, after the OpenTerminal review: "mmm pensemoslo bien, hay cosas que me copan, pero quiero que lo pensemo bien para saber donde ponerle en la app y no hacerlo asi nomas todo desorgnaizado. LO que mas me importa son los datos financieros y demas, como balances,etc, de cada uno de los activos, esto me parece fundamental, tiene que tener su pagina bien clara, en donde se entienda bien cada dato, que sea facil de entender, bien legible . Pero tambien quiero que se pueda buscar la info de cualquier activo que el usuario quiera."
- L2 (2026-10-29) User: "es lo mismo, cualquier activo. sus datos financieros, noticias, cualqueir cosa relevante que importa saber."
- L3 (2026-10-29) User, on the first ten seconds: "si le está yendo bien como empresa y si está cara, ratios, capaz poder compararla con otras empresas"
- L4 (2026-10-29) User: "para cualquier usuario, que no sepa nada de balances, hasta gente mas avanzada". Picked layout B ("Pestañas, como un broker") in the mockups.
- L5 (2026-10-30) User: "solo esos datos tenemos de las acciones? Quiero mas datos, tipo todos los financieros de los ultimos q de hace varios años para ver el cambio, lo mismop con los demas datos"
- L6 (2026-10-30) User, with three TradingView Estadísticas screenshots: "todos estos datos podemos teneetr?" Verified live (MELI, YPFD): all but número de accionistas (misleading), valor liquidativo (fund metric), VE/EBIT esperado (no free EBIT estimate).
- L7 (2026-10-30) User: "y en desktop como se ven" → desktop mockup.
- L8 (2026-10-30) User: "me gusta hacelo". Design written, builder check run (four questions: sources per metric, foreign/ARS currency, peer edits, search scope); three settled as my calls in the design, one asked.
- L9 (2026-10-30) User chose "Dólares CCL" for Argentine amounts. Design committed d58d871. User: "si, hacerlo con odd no?" → ODD; writing-plans skipped, this document is the plan.
- L10 (2026-10-30) Delivery asked (forecast ~4,000 lines). The user chose "Por etapas a prod": stacked-to-main, three stages (see header). T0 written inline. T1 and T2 were launched as parallel writers.
- L11 (2026-10-30) T1 committed in 10ad6e0. T2 done (18 tests, writer verified live on MELI, GGAL.BA, JPM and TSM).
  Findings that shape T3:
  - Yahoo has data for 4 years and 5 quarters (not 5 and 6).
  - Banks lack gross/operating/EBIT/EBITDA/current lines.
  - Yahoo ARS annual mixes as-reported years with IAS 29 restated comparatives: GGAL.BA 2022 ≈ TradingView ×3.10, 2024 ×1.31. Yahoo ARS quarterly and TradingView ARS history are as reported.
  - YPFD.BA statements are in USD on Yahoo, but ARS on TradingView.
  - `XXX=X` is units per USD, like CCL.

  Decisions (mine):
  1. Everything is normalized to USD at each date before any ratio. Statements use the statement currency's rate at the period end. Market cap uses the price currency's rate at the same date. So statement and price currencies may differ per source.
  2. ARS reporters use Yahoo **quarterly** only for group Y (annual dropped). TradingView ARS history converts at CCL as is.
  3. Share counts and EPS are never converted. Per-share values are USD amount ÷ listed units.
  4. Historical market cap = listing price at that date (USD) × listed units at that date. Listed units = ordinary shares then ÷ listing ratio, where listing ratio = ordinary shares now ÷ (market cap now ÷ price now).
  5. Added `'fx'` to `FundamentalsSource`.
- L12 (2026-10-30) T3 done: catalog.ts (44 metrics in 7 sections) and metrics.ts (computeMetrics, changeVsYearAgo, bestPoint, peersMedian).
  - MELI's 12 group-T values today match TradingView within 1e-4.
  - Rotación de activos moved to group T: it needs only revenue and assets, which TradingView has. That gives it 8 years of history.
  - EV = market cap + Yahoo totalDebt − cash and short-term investments.
  - Returns use average balances, as TradingView does.

  Parent spot check (live, NYSE:TSM): market_cap_basic ÷ close = 4.454e9, but total_shares_outstanding = 5.186e9. The market cap follows the Taiwan price, and the ADR trades about 16 % above it.
  Fix, inline and test-first (RED seen): listed units now = TradingView's total_shares_outstanding (per listed unit), with market cap ÷ close only as a fallback; today's market cap = close × units.
  - Two tests now read the fixture's share count.
  - Per-share values no longer need a price.
- L13 (2026-10-30) T4 done. New: service.ts (`getAssetPage`) and `GET /api/asset/[ticker]?vs=`. 80 tests pass.
  - Live smoke: MELI and TSM match TradingView's P/E and net margin exactly. Payload is about 80 KB.
  - Keys are `fund:v1:<kind>:<id>`, each holding `{at, value}` with a 7-day TTL. Fresh windows: snapshot 15 min; history, Yahoo, FX and peers 24 h. A stale copy is served when a source fails; null answers are never cached.
  - FX is stored as month-end rates (8 KB instead of 180 KB per currency).
  - Argentine ADRs move to their BYMA listing through TradingView `logoid` + `country`.

  Decisions (mine):
  1. BCBA:GGAL P/E is 39.8 in USD-at-each-date terms, vs 42.5 in nominal pesos and TradingView's 51.5. With high inflation, a TTM summed in nominal pesos understates current earnings. Converting each quarter at its CCL is the consistent measure, so S7's "ARS price over ARS statements" is replaced by L11 #1.
  2. Default peers' keys come from TradingView's own answers, not free text, so they skip `resolveTickerIdentity`. S12 is amended to say so.

  Open for T10: Yahoo `not_found` (ETFs) shows as `error`. A price status is not exposed; bars-cache serves its own last good copy.
- L14 (2026-10-30) T5 done. New: `/activo/[ticker]` (AssetView, AssetHeader, AssetTabs hidden while there is one tab), ShellSearch, and "Ficha" links in the chart header and in Resumen holdings.
  - ShellSearch searches holdings, the catalog, Yahoo and ONs. ONs go to `/ons/<isin>`, read from `/api/ons`, because `/api/ons/search` has no ISIN. `/` focuses it on desktop; on the phone a top-bar button opens it.
  - Existing taps keep their destinations. Watchlist and Operaciones got no links (a single-button row; Operaciones mixes asset types).
  - Committed with the NumerosTab contract stub; T6 replaces it.

  Open: two searches now exist. Sidebar "Buscar activo" and Ctrl K open the chart; the new box opens the ficha. Ask the user at the stage-1 review.

  Follow-ups (T5b):
  1. `/activo` is missing from `src/middleware.ts` protectedPaths/matcher. Risk item 2: it gets its own commit and a verifier.
  2. The header price comes from the identity cache, up to 7 days old, and there is no day change. Use the TradingView snapshot close and change instead.
- L15 (2026-10-30) b745db6: `/activo` added to the middleware's protectedPaths and matcher, test-first (RED seen). Risk item 2.
  - The independent verifier PASSED, with no blockers. It ran a before/after probe with Next's own matcher.
  - Signed out: `/activo`, `/activo/MELI`, `?vs=` and `BCBA%3AGGAL` all redirect with the return path. Signed in: 200.
  - Every other path is unchanged.
  - Advisory: the test covers only the signed-out case.
  - The native review of b745db6 is deferred until the tree is stable after T6.
- L16 (2026-10-30) T6 done.
  - New: `explain.ts`, which holds all copy: "¿Qué es?" for the 44 metrics, "¿Cómo viene?" built only from the numbers, and a reason for every "—". Also `NumerosTab`, `HistoryPanel` and `LineChart` (inline SVG).
  - The open metric lives in `?dato=`. The panel is sticky from 1024 px; below that it is full screen with "‹ Números".
  - Writer checked a live MELI response in the browser at 11 widths, light and dark.
  - Parent looked at the 1440 and 390 screenshots: they match the approved mockups.

  Defects found by the parent:
  - "▼ 2,6 puntos en un año" compares the hoy point (dated today) with the point a year before today (2025-09-30). The right comparison is the same period a year before the latest statements (2025-06-30, 8,5 % → 3,2 puntos).
  - The writer reported that in quarterly mode the series ends with today's 12-month value, so per-share flows jump about ×4. Its UI drops that point (`ponytail:`); the fix belongs in `metrics.ts`.

  → T6b fixes both in `metrics.ts` and removes the UI workaround.

  Still open for later stages (service): a field for the listing currency (BYMA price target in pesos) and the analyst count. Both are needed by T9.
- L17 (2026-10-30) T5b done (follow-up 2 from L14): the header price comes from the asked listing's TradingView snapshot close (15-minute cache), with the day change below it as "−36,09 (−2,16 %) hoy". TradingView columns: `change` is the percent, `change_abs` the amount.
  - A plain ADR keeps its own quote.
  - Unsupported markets keep the identity price and show no change.
  - A stale snapshot shows the price but no "hoy" change.
  - 52 tests in the touched dirs (RED first, 2 mutations caught).
- L18 (2026-10-30) T6b done. `MetricValue.asOf` holds the latest statement period end the hoy value is built on.
  - `changeVsYearAgo` now compares with the same period a year earlier: MELI net margin ▼ 3,2 puntos, against 2025-06-30.
  - Quarterly per-share flows (catalog `periodFlow`) no longer get the hoy point. TTM and annual keep it, so S5 holds for TTM.
  - The UI workaround was removed. Tests pinning the old behavior were rewritten.
  - 117 tests pass in fundamentals + asset.
- L19 (2026-10-30) Native review (RDD on, the user granted).
  - The whole stage-1 candidate exceeded the native context budget (`lens_context_budget_exceeded`), so it was split into the two high-risk slices, reviewed in temporary worktrees:
    - service + API, 12a66b4..5dbd7ba, lenses risk and resilience (lineage review-658ebef33404ef70);
    - auth guard, 21c43aa..b745db6, lens risk (lineage review-9fad45d43c1ed8ba).
  - Both were approved and acknowledged (`gentle-ai.review-acknowledged/v1`). The worktrees were removed.
  - Non-blocking resilience advisories, fixed as T4b:
    1. `?vs=` lets one user write about 360 tickers' keys per minute with a 7-day TTL into a noeviction Redis, with no global cap.
    2. No failure marker: during an outage every view calls the failing upstream again for the company and up to 5 peers, then waits before serving stale.
- L20 (2026-10-30) T4b fixes both review advisories, test-first (RED seen). 104 + 20 tests pass.
  - **Memory guard.** `cachedEach`, the single write path for `fund:v1:` keys, skips writes when Redis `used_memory ÷ maxmemory ≥ 0.5`; the page is still served. The share comes from the new `redisMemoryShare()` in `redis.ts`, read via INFO at most every 10 s, null if unknown.
  - **`?vs=` peers.** Their keys live 2 days instead of 7.
  - **Failure marker.** `fund:v1:failed:<kind>:<id>`, TTL 300 s, is written after a failed refresh. While it exists, the stale copy is served with no upstream call.
  - Outside scope: `resolveTickerIdentity` keeps its own 7-day keys (small).
- L21 (2026-10-30) Stage-1 UI check on a disposable `/preview-activo`: the real AppShell + AssetView with recorded live JSON for MELI, GGAL, TSM, YPFD and 7203.T, at 11 widths, light and dark.
  - Layout passes: no horizontal scroll, sticky panel from 1024 px, phone full-screen history, tips in the viewport, `/` search. MELI matches both mockups. Net margin ▼ 3,2 puntos.

  Defects to fix before showing the user:
  1. **Blocker.** TradingView's BCBA:YPFD history is labeled ARS, but its newest quarter (2026-09-30) is in USD. Converting it at CCL shrinks it about 1.600×: Deuda per share 0,00, P/E 19,6, P/S ▲109 %.
  2. **Medium.** The default panel (MELI P/E) joins a 9-quarter gap with a straight line. An outlier (1.925,9 in 2019) squashes four years into the bottom 5 %.
  3. **Low.**
     - GGAL badge says "NasdaqCM".
     - The BYMA note appears twice.
     - The subtitle says "Últimos 12 meses" for balance metrics.
     - "—" in the list while the row's chart has history.
     - "?" wraps alone; peer names are truncated.
     - 7203.T shows its price with no currency.
  4. **Consistency.** MELI "Deuda" per share (TradingView debt) ÷ book value = 2,34, but "Deuda / patrimonio" shows 1,68 (Yahoo debt). "Flujo de caja libre" (TradingView) ≠ OCF − CapEx (Yahoo).

  Decisions (mine):
  - (a) A point of an ARS-labeled series that is clearly already in USD is not converted. "Clearly" means: its raw value is close to its neighbours' USD-converted values while its converted value is >100× smaller.
  - (b) Every debt-based metric (Deuda / activos, Deuda por acción) and Flujo de caja libre por acción move to group Y, so all debt figures share Yahoo's definition, like D/E and EV. They lose depth (8 → 4 years) but no longer contradict each other. EBITDA stays split (margen EBITDA T, VE/EBITDA Y) and is noted in its "?".
  - (c) The chart breaks the line at gaps of more than one period. It clamps a far outlier to the axis edge, keeping its value on hover.
  - (d) The default panel is Margen neto, as in the approved mockup.
  - (e) The exchange badge uses the TradingView exchange of the asked listing. A listing-currency field goes in AssetPage.

  Two parallel writers (disjoint surfaces):
  - T6c: data, in metrics.ts, catalog.ts and service.ts.
  - T6d: UI, in numeros/*, AssetHeader and explain.ts.
- L22 (2026-10-30) T6c done (data fixes). 113 tests pass.
  - **(a) Currency switch.** `toUsd` treats a period of a non-USD series as already USD when a strict majority of its lines vote so. Majority, not any line, so a near-zero net income cannot flip a period.
    - YPFD now: P/E 8,85 (ADR 8,71), P/S 0,86, Deuda por acción 2,80, rotación 0,71, margen neto 9,75 %.
    - TradingView's own YPFD snapshot has the same defect: P/E 21,4.
  - **(b) Debt and FCF.** Deuda/activos, Deuda por acción and FCF por acción are now group Y.
    - FCF = OCF − |CapEx| from Yahoo, because Yahoo's freeCashFlow line equals OCF for YPFD.BA.
    - MELI deuda/acción ÷ libro/acción = D/E 1,6819 exactly.
  - **(e) Exchange and currency.** `exchange` is the asked listing's TradingView prefix. New optional `listingCurrency`.
  - **Item 4.** The "hoy" anchor is the source's latest period, so "—" appears only when that period lacks the input.
  - Decision (mine): the BCBA badge displays as "BYMA" (sent to T6d).
- L23 (2026-10-30) T6d done (UI fixes). 57 tests pass in asset + explain.
  - The chart splits runs at gaps over 1.5 periods.
  - Outliers beyond 2 × IQR are pinned to the edge with ▲▼; their real value shows on hover and in the text alternative. MELI P/E axis is now about 170 instead of about 2.150.
  - The default panel is Margen neto.
  - Subtitles depend on the metric kind ("Últimos 12 meses a…" vs "Al cierre de…"), read from the catalog formula.
  - The BYMA note appears once.
  - "Falta el dato del último trimestre".
  - ADR target reads "(en BYMA)" in pesos.
  - "?" stays with its word; peer names wrap.
  - "Precio en <exchange>" when there is no currency.
  - Badge = `exchange`, BCBA shown as BYMA.
  - The preview was re-recorded with the fixed metrics: MELI P/E 44,1; YPFD P/E 8,9, Deuda/acción 2,80; GGAL badge NASDAQ.
- L24 (2026-10-30) User, after trying the stage-1 preview: "esta bastante bien, lo unico que no me cierra es el responsive, capaz para tener mas espacio hace que el menu (sidebar) se colapse, asi se puede ver mejor las tablas, ahora como esta todo encimado, y algo importante es que siempre se facil de leer, bien legible, que se pueda entender"

  → T6e reopens S3/S12 for the layout. Decisions (mine):
  1. **Reuse the Gráficos icon menu.** On /activo, from 820 px, the menu shows only its icons. Its » pin and the remembered preference are shared with Gráficos (`ICON_MENU`, `warren-menu-pinned` in AppShell).
  2. **Layout chosen by measured width.** Labels must not wrap into 2+ lines on desktop, and the list and the history panel must never feel cramped. Below a width where two list columns plus the panel fit with readable labels, use one list column beside the panel, or the full-screen history.
  3. **Legibility pass.** Body text ≥ 15 px on the list and the cards. Important text uses ink/ink-2, never ink-3. Explanations are at most about 65ch per line. Tap targets ≥ 44 px on phone. Comfortable row spacing.
- L25 (2026-10-30) T6e done.
  - **Menu.** `AppShell` takes an `iconMenu` prop; `/activo/layout` passes it. The menu is icon-only from 820 px with the shared » pin; Gráficos is unchanged.
  - **List.** One column of sections at every width, in reading order: two columns cannot fit beside a 360 px panel within PAGE's 1,160 px.
  - **Panel.** Beside the list from 1024 px (≥ 360 px wide, up to 496 px). Full screen below that.
  - **Legibility.**
    - Text: 15 px rows and cards, 17 px section headings, 44 px rows and tap targets, ink/ink-2 for text, explanations ≤ 65ch.
    - Contrast: AA in light and dark (ink-2 ≥ 7.4:1).
  - **Measured.**
    - 0 wrapped labels at 820–1920 (before: 7 at 1024, 5 at 1440).
    - No horizontal scroll at any of the 17 widths.

  Open, minor:
  - The panel scrolls inside itself on screens under about 1000 px tall.
  - With the menu pinned open, 1024–1100 px cramps again.
  - PAGE's max-width leaves margins at 1600 px and up.
- L26 (2026-10-30) User: "si apruebo, merge todo de una, mientras que este bien vaqlidado y verifiaco todo". Pre-merge validation on a clean tree, with the preview and its server removed:
  - `npm test`: 3,448 tests pass.
  - `npm run type-check`: 0 errors.
  - `npm run lint`: 0 errors.
  - `npm run build`: OK (/activo/[ticker] 16 kB).
  - RDD assess 45e0ba7..HEAD: medium, under_budget. The high-risk slices were already reviewed and approved (L19).
  - Next: push, CI, PR, squash merge, deploy check.
- L27 (2026-10-30) Stage 1 delivered.
  - Branch CI run 41080835100 green.
  - PR #49 squash-merged as 73ff07d.
  - Master run 41081377001: test, image and deploy all success.
  - Production checks:
    - `/api/health` ok (redis, supabase, worker fresh);
    - signed-out `/activo/MELI` → 307 to `/auth/login?next=%2Factivo%2FMELI`;
    - `/api/asset/MELI` → 401.
  - Pending: the user's test on the iPhone.
  - Stage 2 (T7–T10) continues on `feat/asset-page-stage2` from master 73ff07d.
- L28 (2026-10-30) T8 done.
  - New: `news.ts`, `GET /api/asset/[ticker]/news` (auth, 30/min), and `NoticiasTab` (not wired yet).
  - Sources: Google News RSS es-419/AR, queried by the quoted short name cut at its legal form; Yahoo `search` with the US symbol, or the unaccented name for BYMA.
  - Merge: Spanish first, at most 5 English, 20 in all, deduplicated by title.
  - Filters: drops stock-quote pages and headlines that don't name the company.
  - Cache: per-source keys `fund:v1:news:<ticker>:<lang>`, 30-min fresh window, 1-day TTL, 5-min failure marker, memory guard. service.ts now exports `cachedEach`/`eachOf`.
  - Live: 15 es + 5 en for MELI, GGAL, TSM and YPFD.
  - Open: GGAL's press says "Grupo Galicia"/"Banco Galicia", so name variants would need a per-company map.
- L29 (2026-10-30) T7 done.
  - New metrics:
    - `revenueGrowth` (group T, TTM vs the TTM a year earlier; MELI 46,0 %);
    - `marketCap` (group 'quote': close × listed units in USD, the same base as every price ratio).
  - Forward rows carry `better: 'lower'`.
  - `ComparaTab`:
    - Sortable table with the "mejor" marker and the company's place, e.g. "5.º de 6".
    - Phone: the table scrolls inside its box with a sticky first column.
    - Peers: chips, add via search, remove, reset. Edits go to `?vs=` (max 5) with `router.replace`.
  - Integration still to do: wire the Comparar, Noticias and Resumen tabs in AssetView. Keep the previous page while a new `?vs=` loads, so the tab doesn't jump.
  - Follow-ups:
    - per-peer source status, so a missing value can say "la fuente no respondió";
    - a client-safe `parseTicker`.
- L30 (2026-10-30) T9 done.
  - **AssetPage additions:**
    - `profile` (Yahoo, asked listing). Cached as `fund:v1:profile:<sym>`, 6 h fresh.
    - `PeerToday.sources`, so a missing value can say "la fuente no respondió".
    - A client-safe `parseTicker` in `ticker.ts`, re-exported by service.
  - **summary.ts thresholds:**
    - Growth labels: "Crece fuerte" ≥ 15 %, "Crece" ≥ 3 %, "Vende menos" ≤ −3 %.
    - P/E vs the peers' median and vs its own 5-year median: ±15 % counts as "más cara/más barata". With a loss, P/S replaces P/E.
    - Advice words are banned by test except in the footnote.
  - **ResumenTab:** answer cards (mockup A), 52-week bar, analysts with footnote, results with estimate vs actual, company facts.
  - **AssetView:** tabs Resumen (default), Números, Comparar, Noticias, kept in `?tab=`. The previous page is kept during a `?vs=` refetch.
  - Parent looked at MELI at 1440 and 390: clear and legible.
  - **Open:** S5 — the analyst target in Resumen (Yahoo, asked listing) can differ from Números' "Precio objetivo" (TradingView, numbers listing). It goes to T10.
- L31 (2026-10-30) T10 done.
  - **AssetPage additions.** `kind` (company/etf/crypto/other) from Yahoo quoteType; `AssetProfile` gains fund, crypto and price fields.
  - **ETF.** Holdings, sectors, expense ratio and returns ride in the profile key. Tabs: Resumen, Composición, Noticias. Holdings link to `/activo/<symbol>`.
  - **Crypto.** Detected from the identity's exchange CCC, with no TradingView. Cached as `fund:v1:crypto:<sym>`, 15-minute fresh window. `parseTicker` maps BTCUSDT → BTC-USD. The day change counts from 0 h UTC, and the card says so.
  - **ONs.** `/activo/<ON ticker or ISIN>` redirects server-side to `/ons/<isin>`, reading the ON catalog only for tickers Yahoo doesn't know.
  - **Unsupported markets.** Message plus Noticias.
  - **S5 target.** Números' "Precio objetivo promedio (N analistas)" now equals Resumen's: Yahoo, asked listing, profile group.
  - **Fix.** Resumen scrolled 19 px sideways at 320 px; cards now get `min-w-0`.
  - **Risk.** Writer named item 3: shared `parseTicker` now maps *USDT, a production API input. It is additive. Native review at stage end will cover it.
- L32 (2026-10-30) Stage-2 seam check on ad20401:
  - `npm test`: 3,564 tests pass.
  - type-check and lint: 0 errors.
  - `npm run build`: OK (/activo 26 kB, plus /api/asset/[ticker]/news).
  - RDD assess 73ff07d..HEAD: medium, under_budget, not due.
  - Risk (mine): none. `parseTicker` accepting *USDT is an added input form, not a change to an existing one (item 3 excludes additions). The news route reuses requireUser + rateLimit unchanged.
  - Asked the user for the stage-2 merge OK.
- L33 (2026-10-30) User: "si, mergeá todo a prod" → push, CI, PR, squash merge and deploy check for stage 2.
- L34 (2026-10-30) The branch CI failed on NoticiasTab. The CI log shows Node 22's ICU writes "2 sept 2025" where Node 26 writes "2 sep 2025"; browsers vary too.
  - Fix: fixed Spanish month names, `MONTHS` exported from explain.ts, built from the Argentine date string, instead of `Intl` short months.
  - A local RED on Node 22 was not possible: downloading node@22 via npx was denied. The CI diff is the evidence.
  - Long month names (Resumen dates) are stable across ICU versions and passed in CI.
- L35 (2026-10-30) Stage 2 delivered.
  - The branch CI first failed on an ICU month name (L34); after the fix it was green.
  - PR #50 was squash-merged as 0f2a61c. The master deploy succeeded.
  - Production checks:
    - `/api/health` ok;
    - signed-out `/activo/SPY` → 307 to login;
    - `/api/asset/MELI` and `/api/asset/MELI/news` → 401.
  - Stage 3 (T11–T12) continues on `feat/asset-page-stage3`.
  - Pending with the user: the iPhone test, and whether to unify the two searches.
- L36 (2026-10-30) T11 done.
  - **New code:**
    - `statements.ts`, with 37 rows, Spanish labels and "?" copy;
    - `GET /api/asset/[ticker]/statements` (auth, 60/min), reusing the page's cached sources: 0 upstream calls on a warm cache, 13–28 KB;
    - `Balances.tsx`, opened from "Ver balances completos" in Números (`?vista=balances`).
  - **Shared code:**
    - metrics.ts exports the single USD normalization (`inUsd`, `ratesReader`, `tvBook`, `yahooBook`);
    - service.ts extracts `locate`, `ratesOf` and `identify`, shared by the page and the statements;
    - 13 more Yahoo lines.
  - **Row sources:** in the 8-year range, TradingView's eight lines come from TradingView for every column; the other rows stay Yahoo with "desde <año>".
  - **Fixed in the browser check:** sr-only spans escaped the scroll box, so the box is now `relative`.
  - **Follow-up (mine), folded into T12:** a USD quarter inside a peso series leaves the EPS row in mixed currencies. Statement EPS (per ordinary share) is converted to USD at each period end through the same `inUsd`, like amounts, and labeled "US$ por acción".
- L37 (2026-10-30) T12 done.
  - **sec.ts.** Maps ticker → CIK, cached as `fund:v1:secmap:tickers`. Normalizes companyfacts to compact USD series, cached as `fund:v1:sec:<sym>` (20–29 KB), 24 h fresh, through `cachedEach`.
    - One us-gaap concept per company per line, chosen from a definition-ordered list. Not by period count: MELI's contract revenue leaves out fintech income.
    - Quarters come from same-start YTD differences (Q4 = FY − 9M). Only 10-K and 10-Q facts are used.
    - 20-F and IFRS filers → null.
    - EPS and share counts are never read from the SEC (pre-split mix).
  - **Table.** SEC rows win across all columns; "Todo" appears when SEC rows exist; the note names the source.
  - **EPS fix (L36).** "Ganancia por acción (US$)" goes through `inUsd`.
  - **Config.** SEC is gated on env `SEC_USER_AGENT` (absent → no request). Documented in the README.
  - **Live.**
    - MELI and NVDA quarters back to 2008/09; revenue Q1–Q4 sum to the year (MELI 2025: 28.893 M; NVDA FY2026: 215.938 M). Restatements make MELI 2022 differ.
    - TSM → null.
    - Warm loader: 2 ms.
  - **Risk item 5.** The env var must be passed through `docker-compose.yml` (own commit). The production `.env` value is the user's decision.
- L38 (2026-10-30) Verification of stage 3.
  - **Compose verifier (e5336f7): PASS.** Docker Compose config renders `SEC_USER_AGENT: ""` when the variable is unset; nothing else changes; the worker never imports fundamentals.
  - **SEC UI check** (live MELI, NVDA, GGAL; 4 widths × 2 themes): layout passes. No page scroll; the sticky column holds; "Todo" only appears with SEC; the note, EPS label and ▲▼ are right; row → chart works; 0 console errors.
  - **Defects found:**
    - D1: SEC keeps fiscal period ends (NVDA 2021-05-02), so one quarter splits into two columns and is mislabeled.
    - D2: "SEC wins" even when its row is shorter or has holes. MELI Ventas loses 2019–2020; FCF starts in 2024 instead of 2018.
    - D3: LineChart's IQR outlier rule pins the fast growth of amounts to the edge (NVDA Ventas in Todo: 12 of 73 points).
    - D4: chart year labels overlap at 390.
    - D5: missing periods vanish with no marker.
    - Advisory: in 8 años and Todo, the label column squeezes and wraps at 1440.
  - **Decisions (mine), fixed as T12b:**
    - (1) Snap SEC period ends to the nearest month end, as TradingView does (day ≤ 7 → the previous month's end).
    - (2) Per row and range, the source is the one with the longest contiguous run ending at the latest period. Ties go to the SEC. Still one source per row.
    - (3) Outlier clamping only for valuation ratios (unit ratio), never for amounts, balances or flows.
    - (4) Thin the year labels to fit the width.
    - (5) Mark gaps of more than one period with a thin "…" column.
    - (6) Give the label column a minimum width on desktop.
- L39 (2026-10-30) T12b done; 3,656 tests pass.
  - **D1.** SEC ends snap to month ends after period lengths are computed. NVDA feb–abr 2021 now fills.
  - **D2.** The per-row source is the longest unbroken run ending at the latest period (ties: SEC, TradingView, Yahoo). MELI Ventas 8 años 32/32; FCF back to 2018.
    - Consequence: in Todo, MELI and NVDA Ventas come from TradingView (2018→), because both SEC revenue rows have a hole (MELI 2019–20, NVDA FY2019).
  - **D3.** LineChart `clamp` only for unit ratio. Amounts are never pinned; P/E still is.
  - **D4.** Year labels are thinned to 36 px each.
  - **D5.** "…" gap columns with "Sin datos entre …".
  - **Label column.** ≥ 14rem on desktop.
  - Browser re-check (MELI, NVDA, GGAL × 4 widths × 2 themes): no defects left.
- L40 (2026-10-30) Stage-3 final check on cb7cb26:
  - 3,656 tests pass (writer run); type-check and lint have 0 errors; `npm run build` OK.
  - RDD assess 0f2a61c..HEAD: medium, under_budget, not due.
  - The compose change (item 5) had its independent verifier pass (L38).
  - Asked the user for the stage-3 merge OK.
  - The SEC stays off in production until `SEC_USER_AGENT` is set in the server's .env (the user's decision).
