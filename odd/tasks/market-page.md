# Market page: Panel líder, CEDEARs and your lists, in Pesos / MEP / Cable

Objective: a "Mercado" page (`/mercado`) to see how the Argentine market moves today, with the same watchlists as Gráficos and links to the chart and the asset page, as designed in `docs/superpowers/specs/2026-10-31-market-page-design.md` (layout B approved, L5–L6). Also the shell search aligned with the page (S1).
Branch: `feat/market-page` (from `master` 6b6e590). Delivery: ask-on-risk → `stacked-to-main` by default, as the asset page (user's earlier "Por etapas a prod"); each slice goes to `master` with the user's OK, as its own PR. Forecast ~1,300 authored lines. Slices: PR-A = T1; PR-B = T2–T3 (no UI); PR-C = T4–T6.
Runner: vitest (`npm test`), `npm run type-check`, `npm run lint`. UI checked in headless Chromium at 11 widths (320–1920) on a disposable public page.

## Specs

The design document is the detailed specification; each S# names its sections there. Workers read the design document's named sections, and this file until `## Log`.

- S1 Search aligned with the page. User (L1): "este input tiene que estar alineado con cartera". Acceptance: on desktop (≥820 px) the shell search's left edge equals the page content's left edge, on the Resumen (1680 px column) and on every other page (1240 px column), at every width up to 2400 px; phone unchanged.
- S2 A market page. User (L1): "que las acciones tengan su propia pagina como las tienen las ons, en donde se pueda ver el cambio de todas las acciones, tambien este el buscador". User (L2): "me gustaria ver como viene las acciones en el dia y tener facil de acceso el mercado para despues poder de ahi ver el grafico o los datos financieros". User (L5): "la B, como el panel de listas de Gráficos". Design: Goals 1, 2, 4, 7, 8 and "Table behavior". Acceptance: menu item "Mercado" → `/mercado`; desktop = list column (Mercado: Panel líder, CEDEARs; Mis listas: Cartera, the user's lists, "+ Nueva lista"; counts) + table (Ticker and name, Precio, Var. día chip, actions); search filters the selected list; sort by any column, default Var. día descending; list and sort in the URL; pages of 100 with "Mostrar más"; phone = list dropdown on top, compact rows, tapping a row offers Gráfico, Ficha, add to a list; refresh ~1 min while BYMA is open; closed market shows last close and says so.
- S3 Universe and prices. User (L3): "CEDEARs y acciones argentinas del panel líder . Que se puedan ver en pesos, mep y ccl". Design: Goal 3, "Prices: one number, one meaning", "Universes". Acceptance: Panel líder = fixed BYMA list in code with source and date; CEDEARs = every peso line of data912 `arg_cedears`, never a `…D`/`…C` dollar line as its own row; price = BYMA peso line, MEP/Cable = pesos ÷ the Resumen's MEP/CCL (`getDollarInfo`, `inCurrencies`); Var. día = the peso line's `pct_change` in every currency; currency selector = the Resumen's `CurrencySelector` and stored choice `resumen:currency`.
- S4 Lists are Gráficos' lists. User (L1): "Tambien quiero poder crear wathlist". User (L4): "Quiero poder crear listas, que sean las mismas que las listas que estan en graficos, en donde se pueda ver los cedears o lo que sea que guardaste junto". Design: Goal 5 and "Lists". Acceptance: existing `watchlists`/`watchlist_items` and routes, no migration; create, rename, delete a list and add/remove an asset from Mercado and the same change shows in Gráficos and back; Cartera is the auto list of held stocks, not editable; "Lista local" not shown; symbol identity as the design's "Which stored symbols mean which BYMA line" (`BCBA:X` = `X.BA` = local share, written as `BCBA:X`; plain CEDEAR `X` written as `X`; plain non-CEDEAR matching a local share = US ADR, "ADR en EE.UU., no cotiza en BYMA", never priced at the share's price); other non-BYMA items "No cotiza en BYMA"; reading a list for Mercado fetches no Yahoo price per item.
- S5 Gráfico and Ficha. User (L1): "y que se puueda ir al grafico o a la ficha financiera". Design: Goal 6 and "Links". Acceptance: Gráfico → `/trading?symbol=<symbol>` with the symbol the Resumen links for that asset; Ficha → `assetHref(ticker)`.
- S6 The app's look. User (L6): "está bien así, lo unico que no pongas esos emjois y porfavor segui la aestetica de la pagina". Design: "Aesthetic". Acceptance: no emojis; lucide icons at stroke 1.5; only the app's tokens, fonts, number format and existing components (`components/ons/ui.tsx`, `Chip`/`toneOf`, `priceText`, `CurrencySelector`, Gráficos' list-panel look); light and dark.
- S7 Constraints. Design: "Constraints", "Non-goals", "Anti-goals". Acceptance: no Supabase writes except the user's list edits; prices through Redis only, every key with a TTL; one upstream data912 request per feed per refresh window shared by all users; per-user rate limit on new routes; 320–1920 px with no horizontal page scroll and 44 px touch targets; Gráficos unchanged; no personal portfolio data in repo, tests, commits or PRs. BYMA symbol mapping (DIS→DISN, BRK-B→BRKB) deferred by the user (L7): known accepted defect.

## Tasks

| ID | Specs | Route | Status | Evidence |
|----|-------|-------|--------|----------|
| T1 | S1 | inline | done, verified | RED→GREEN `AppShell.test.tsx` "lines the search up…"; Chromium 12 widths 320–2400 aligned, no h-scroll; suite 3657 pass, tsc, eslint |
| T2 | S3, S7 | delegated (parallel unit A, Writer trigger a: independent of T3, disjoint surface, ~300 lines) | pending | |
| T3 | S4, S7 | delegated (parallel unit B, Writer trigger a: independent of T2, disjoint surface, ~150 lines) | pending | |
| T4 | S2, S3, S5, S6, S7 | inline | pending | |
| T5 | S4, S6 | inline | pending | |
| T6 | S2–S7 | inline | pending | |

- T1 Shell search takes the Resumen's wider column on `/dashboard`.
- T2 Market feed: a cached server route serving Panel líder and CEDEAR peso rows (symbol, name, kind, price in pesos, `pct_change`), the MEP/CCL rates and the market state; the fixed Panel líder list; shared Redis cache with TTL, one upstream request per feed per window, per-user rate limit.
- T3 Symbol identity helper (stored list symbol → BYMA peso line, US ADR, or none; the symbol to write when adding) and a symbols-only read of a list's items; Gráficos' current `GET /api/watchlist` unchanged.
- T4 `/mercado` page and menu entry: list column / phone dropdown, table, currency selector, search, sort and list in the URL, pagination, row links, market state line.
- T5 Lists from Mercado: star to add/remove (popover with the user's lists), create / rename / delete a list from the column.
- T6 Browser check at 11 widths in light and dark, help text and docs.

## Log

- L1 (2026-10-31, user's original request, verbatim): "[Image #12] este input tiene que estar alineado con cartera. Despues de este quiero encarar otra cosa, que las acciones tengan su propia pagina como las tienen las ons, en donde se pueda ver el cambio de todas las acciones, tambien este el buscador, y que se puueda ir al grafico o a la ficha financiera. Tambien quiero poder crear wathlist"
- L2 (2026-10-31, user): "me gustaria ver como viene las acciones en el dia y tener facil de acceso el mercado para despues poder de ahi ver el grafico o los datos financieros"
- L3 (2026-10-31, user): "CEDEARs y acciones argentinas del panel líder . Que se puedan ver en pesos, mep y ccl"
- L4 (2026-10-31, user): "Quiero poder crear listas, que sean las mismas que las listas que estan en graficos, en donde se pueda ver los cedears o lo que sea que guardaste junto"
- L5 (2026-10-31, user, on the three layout mockups): "la B, como el panel de listas de Gráficos"
- L6 (2026-10-31, user, on the playback and the B mockup): "está bien así, lo unico que no pongas esos emjois y porfavor segui la aestetica de la pagina"
- L7 (2026-10-31, user, on fixing the BYMA symbol mapping now for the whole app): "para despues, trabaja ocn odd"
- L8 T1 analysis: the Resumen (`src/app/dashboard/page.tsx`) is the only page with a 1680 px column; every other page uses `PAGE` (1240 px), and so did the search → 220 px off on viewports ≥1680. Fix: `ShellSearch` `wide` prop, set by `AppShell` when the current section is `/dashboard`. Recon (explorer + builder check): data912 feeds return everything but the worker caches peso prices only for held tickers; no Panel líder list exists; `arg_stocks` = 96 symbols (líder + general + dollar lines), `arg_cedears` = 1029 rows with `…D`/`…C` lines; Gráficos stores `GGAL.BA` (Yahoo search) or `BCBA:GGAL` (portfolio); `GET /api/watchlist` fetches a Yahoo price per item. Next: commit T1, then T2 ∥ T3.
