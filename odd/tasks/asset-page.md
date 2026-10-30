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
- S3 Números as approved. User (L8, desktop): "me gusta hacelo". Design: Goal 3 and "Metric catalog". Acceptance: the groups and rows of the catalog; mobile = list + "?" popover + tap → full-screen history with "‹ Números"; desktop = two-column list + sticky history panel; history panel = value with change vs a year earlier, 2/5/8 años, Trimestral/Últimos 12 meses/Anual, line chart with best point and hover value, "¿Qué es?", "¿Cómo viene?" (only what the numbers show), "Contra sus parecidas" bars; forward metrics, target, shares, float and employees have no chart.
- S4 History of every number. User (L5): "solo esos datos tenemos de las acciones? Quiero mas datos, tipo todos los financieros de los ultimos q de hace varios años para ver el cambio, lo mismop con los demas datos". Design: "One computation". Acceptance: group T metrics show up to 32 quarters / 20 years (TradingView), group Y up to 5 years / 6 quarters (Yahoo) with "historia desde <año>" when shorter.
- S5 One number, one meaning. Design: Goal 4 and "One computation". Acceptance: for any metric, the list value equals its chart's "hoy" point and every peer's value comes from the same source and function; a metric never mixes sources across periods or companies; ADR/foreign ratios use market cap (no per-share ADR ratio), foreign statements converted at each period end's FX.
- S6 The statistics the user asked for. User (L6, showing TradingView's Estadísticas): "todos estos datos podemos teneetr?". Design: "Metric catalog" (dropped: número de accionistas, valor liquidativo, VE/EBIT esperado).
- S7 Argentine companies in dollars. User's choice (L9): "Dólares CCL". Acceptance: amounts and their growth for ARS reporters are converted at the CCL of each period's end (app's CCL history); ratios stay currency-neutral (ARS price over ARS statements); no ARS toggle; plain tickers of Argentine ADRs use the `BCBA:` listing for Números with the note "Datos de <empresa> en BYMA"; the IAS 29 question (as reported vs restated) is checked per source before converting.
- S8 Balances completos. User (L5) as S4. Design: Goal 5. Acceptance: link at the end of Números; Resultados / Balance / Flujo de caja tables, one row per line, one column per quarter or year, horizontal scroll inside the container only, ▲▼ vs the same period a year earlier, tap a row → its chart; per row one source (SEC for US 10-Q filers since ~2009, else Yahoo; TradingView rows for its eight lines in the 8-year range).
- S9 Comparar. User (L3): "si le está yendo bien como empresa y si está cara, ratios, capaz poder compararla con otras empresas". Design: Goal 6 and "Peers". Acceptance: company + up to 5 peers (same industry and market by market cap; filled from the US market when a BYMA industry has fewer than 3) on P/E, P/E esperado, crecimiento de ventas, margen neto, ROE, deuda/patrimonio, capitalización; edits live in `?vs=` and apply to the whole page.
- S10 Noticias. Design: Goal 7. Acceptance: Spanish first (Google News RSS es-419/AR), plus Yahoo English; newest first; de-duplicated by title; source and age; links out.
- S11 Resumen. User (L3) as S9. Design: Goal 8. Acceptance: "¿Le va bien como empresa?" and "¿Está cara?" stated from data, never as advice; 52-week range; analysts' average target and count; next earnings date and the last four quarters' estimate vs actual; sector · industry · country · employees.
- S12 Constraints. Design: "Constraints" and anti-goals. Acceptance: Redis only (no Supabase table or write); every key has a TTL and derives only from a ticker resolved by `resolveTickerIdentity` in a supported market; normalized payloads ≤ ~30 KB per company per source; per-user rate limit on the new routes; each section degrades on its own and serves its last good data; responsive 320–1920 with no horizontal page scroll; app tokens light/dark, IBM Plex, Spanish number format; no personal portfolio data in repo, tests, commits or PRs.

## Tasks

Routes: the parent session is past the ~150k context backstop, so implementation tasks go to bounded writers (Writer trigger b); T1 and T2 have disjoint surfaces and several minutes of work each, so they run in parallel (Writer trigger a) on the shared contract `src/lib/fundamentals/types.ts` written inline by the parent (T0).

- [x] T0 · S5 · inline · shared contract `src/lib/fundamentals/types.ts` (Series, Market, AssetRef)
- [x] T1 · S4 S5 S6 S9 · delegated (parallel with T2) · TradingView source: today's catalog values, `_fq_h`/`_fy_h` history with period ends, peers by industry · 19 tests (RED first, 7 mutations caught)
- [ ] T2 · S4 S5 S7 · delegated (parallel with T1) · Yahoo source: normalized statements (quarterly/annual), profile, currency; FX at period ends (Yahoo FX for foreign, app CCL for ARS)
- [ ] T3 · S3 S4 S5 S6 · delegated · pure metrics module: catalog definitions, today + history per metric, peers, group T/Y source rule
- [ ] T4 · S1 S12 · delegated · service + API route: ticker validation and market check, Redis cache with TTLs and last-good fallback, rate limit, per-section errors
- [ ] T5 · S1 · delegated · page shell `/activo/[ticker]`, header, tabs, shell search with `/`, links from every ticker
- [ ] T6 · S2 S3 · delegated · Números UI (mobile + desktop), "?" copy, history panel, peers bars
- [ ] T7 · S9 · delegated · Comparar tab
- [ ] T8 · S10 · delegated · Noticias
- [ ] T9 · S11 · delegated · Resumen
- [ ] T10 · S1 · delegated · ETFs, crypto, ON redirect, unsupported markets
- [ ] T11 · S8 · delegated · Balances completos (Yahoo + TradingView rows)
- [ ] T12 · S8 · delegated · SEC source for Balances completos (US 10-Q filers)

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
