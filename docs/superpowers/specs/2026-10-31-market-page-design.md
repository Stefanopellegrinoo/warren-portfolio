# Market page: how the Argentine market is doing today, with your lists — design

Date: 2026-10-31. The user picked layout "B · Listas al costado" ("la B, como el panel de listas de Gráficos") and approved the playback: "está bien así, lo unico que no pongas esos emjois y porfavor segui la aestetica de la pagina".

## Intent

The user's words: "me gustaria ver como viene las acciones en el dia y tener facil de acceso el mercado para despues poder de ahi ver el grafico o los datos financieros".

Which market: "CEDEARs y acciones argentinas del panel líder. Que se puedan ver en pesos, mep y ccl".

The lists: "Quiero poder crear listas, que sean las mismas que las listas que estan en graficos, en donde se pueda ver los cedears o lo que sea que guardaste junto".

This is the entry point to the market. The app already shows a chart (Gráficos, `/trading`) and a financial page per asset (`/activo/<ticker>`). What is missing is the place where you see the market move and jump into those two pages. ONs already have such a page (`/ons`); stocks do not.

The app serves many users. Nothing here is specific to one account.

## Goals

1. **A new page, "Mercado"**, in the app menu (route `/mercado`), built like layout B:
   - On desktop, a column on the left holds the lists and a table on the right shows the selected list.
   - The column has two groups:
     - **Mercado:** "Panel líder" and "CEDEARs".
     - **Mis listas:** "Cartera" first, then the user's own lists.
   - Each list shows its count, and the column ends with "+ Nueva lista".
2. **The table** has these columns:
   - Ticker with the company name next to it.
   - Price.
   - Var. día, a green/red chip.
   - Row actions: **Gráfico**, **Ficha**, and a star to add the asset to a list or remove it from one.
3. **Pesos / MEP / Cable** selector above the table. It reuses the Resumen's selector and its stored choice (`resumen:currency`, default MEP).
4. **Search box** above the table. It filters the selected list by ticker or name.
5. **The lists are the same lists as Gráficos.** A list created, renamed or deleted here is the same one in Gráficos, and the reverse also holds; the same goes for an asset added or removed. "Cartera" is the same auto-built list of held stocks; you cannot edit it.
6. **Gráfico and Ficha links** open the chart and the asset page of that row's asset.
7. **Phone:** the list column becomes a dropdown at the top. Rows become compact (ticker and name, price, chip). Tapping a row offers Gráfico, Ficha and add to a list.
8. **Live during market hours:** prices refresh about every minute while BYMA is open. Outside hours the page shows the last close and says so, like the Resumen does ("Mercado cerrado, precios al cierre").

## Aesthetic (user requirement)

"no pongas esos emjois y porfavor segui la aestetica de la pagina":

- No emojis anywhere.
- Icons come from lucide-react with the app's stroke width (1.5), as everywhere else (for example `LineChart` / `FileText` / `Star`, the builder's pick).
- Build only with the app's existing pieces:
  - the color tokens (light and dark), IBM Plex and the Spanish number format;
  - `src/components/ons/ui.tsx` (`PAGE`, `PageHeader`, `ScrollTable`, `TH/TD/TR`, `Loading`, `LoadError`, buttons), plus `Chip`/`toneOf` and `priceText`;
  - the Resumen's `CurrencySelector`;
  - the sidebar look of Gráficos' list panel.
- The approved mockup (`.superpowers/brainstorm/…/layout-b.html`, not committed) shows layout only. Its emojis and colors are not the design.

## Prices: one number, one meaning

- **Source:** the BYMA peso line from data912. The app already uses it (`src/lib/data912-client.ts`):
  - `/live/arg_stocks` for panel líder stocks;
  - `/live/arg_cedears` for CEDEARs.
- **Price in MEP / Cable:** the peso price ÷ the day's MEP or CCL. This is the same conversion and the same rates as the Resumen (`getDollarInfo`; `inCurrencies` in `src/lib/multicurrency.ts`).
  - The BYMA dollar lines (`AAPLD`, `AAPLC`, `GGALD`) are **not** shown.
  - Reason (my call): every row gets a value, and the page agrees with the Resumen.
- **Var. día:** the peso line's own `pct_change`, the same figure in every currency. The Resumen already does this per holding (`valuePosition`, `dayChangePct: local.changePercent`).

## Universes

- **Panel líder:** BYMA's official Panel Líder, kept as a fixed list in code.
  - The list records its source and the date it was taken.
  - It is updated by hand when BYMA changes it. My call: no list exists anywhere in the app or the feed (data912's `arg_stocks` mixes panel líder, panel general and dollar lines, 96 symbols).
- **CEDEARs:** every CEDEAR peso line in `arg_cedears` (1029 rows, which include the `…D` MEP and `…C` cable lines).
  - A symbol counts as a peso line when it is in the app's `cedears` table or when its `D`/`C` companion exists in the feed. Example: `AMD` qualifies because `AMDD` exists; `AMDD` does not, because there is no `AMDDD`.
  - The exact rule is the builder's, but it must never show a `D`/`C` line as a separate CEDEAR.
- **Names:** from the app's catalogs (`/api/activos`, `/api/cedears`). When a name is missing, the ticker alone is shown.

## Lists

- **Storage:** the existing Supabase tables `watchlists` and `watchlist_items` (migration 024: per-user RLS, at most 10 lists, no order column), through the existing routes `/api/watchlist/lists`, `/api/watchlist/lists/[id]` and `/api/watchlist`. No new table and no migration.
- **"Lista local"** of Gráficos lives in the browser (zustand). It is **not** shown here. My call: it is per device and is not a list you created.
- **Which stored symbols mean which BYMA line.** My call, following the app's convention: the portfolio stores a CEDEAR as plain `AAPL` and a local share as `BCBA:GGAL`.
  - **Local share:** `BCBA:X` and `X.BA` (Gráficos' Yahoo search returns the second) are the same BYMA share. Its row shows the `X` peso line.
    - The star shows filled when the list holds either spelling.
    - Removing removes every spelling of it in that list.
    - Adding writes `BCBA:X`.
  - **CEDEAR:** a plain ticker `X` is the CEDEAR `X` when `X` is a CEDEAR peso line. Adding writes `X`.
  - **US ADR:** a plain ticker that is **not** a CEDEAR but matches a local share is that company's US ADR. Example: `GGAL`, where one ADR is 10 shares. It is never priced at the local share's price. Its row says "ADR en EE.UU., no cotiza en BYMA" and keeps working Gráfico/Ficha links.
  - This mapping lives in one shared helper, used by the rows, the star and the counts.
- **Reading a list's contents** must not fetch a Yahoo price per item. Today `GET /api/watchlist` does that (`src/app/api/watchlist/route.ts:51-74`). Mercado needs symbols only, so the builder adds a symbols-only read, and Gráficos' call stays as it is.
- **List items with no BYMA peso line:**
  - Examples: `BTCUSDT`, or a US stock with no CEDEAR, added in Gráficos.
  - They show as a row with the ticker, "No cotiza en BYMA" in place of price and change, and working Gráfico/Ficha links.
  - My call: hiding them would make a list look different from Gráficos.
- **Rows in a list are ordered by the table's sort**, like the market lists. There is no manual ordering.

## Table behavior

- Default sort: Var. día descending (my call: the page is about "cómo viene el día"). Every column header sorts.
- The sort and the selected list live in the URL, like the ONs explorer (`src/lib/on-explorer-filters.ts`).
- The search box filters only the selected list. The shell search, at the top of every page, still finds any asset.
- The pattern to follow is `OnExplorer` / `OnExplorerTable`:
  - a `<table>` on wide screens;
  - row cards below about 1080 px;
  - pages of 100 with "Mostrar más" (CEDEARs run to several hundred rows).

## Links

- **Gráfico:** `/trading?symbol=<symbol>`, the same symbol the Resumen links for that holding.
- **Ficha:** `assetHref(ticker)` (`src/components/shell/nav.ts`).

## Constraints

- **No Supabase writes** except the list edits the user makes. Prices go through Redis only, every key with a TTL. Background: `docs` / memory "Supabase eficiente"; the database is small.
- **One upstream request per feed per refresh window**, shared by all users. A user opening the page must never cause a request to data912 per user or per ticker.
  - Today the worker caches peso prices only for held tickers (`price-worker.ts` `getAllTickers`). The builder chooses how the full feeds reach the page: widen the worker, or a cached server route.
- The new route has a per-user rate limit, like the other routes.
- **Responsive, 320 to 1920 px:**
  - no horizontal page scroll;
  - touch targets of 44 px on phones;
  - checked in a real browser at 11 widths.
- No personal portfolio data in the repo, tests, commits or PRs. The repo is public.

## Non-goals

- Gráficos does not change. Its lists keep showing what they show today: a CEDEAR there still shows its US price.
- Panel general, volume, bid/ask and the BYMA dollar lines.
- Bonds and ONs: they have `/ons`.
- Price alerts from this page.
- Ordering items inside a list.
- "Lista local".
- **The BYMA symbol mapping** (Disney is `DISN` on BYMA but `DIS` in the app; Berkshire is `BRKB` but `BRK-B`). The user chose "para despues": it stays in the backlog (`odd/tasks/multimoneda.md` L13).
  - Until then, those few CEDEARs appear under their BYMA symbol with no name.
  - Their Gráfico/Ficha links and star use that symbol.
  - A `DIS` in a list reads "No cotiza en BYMA".
  - This is a known, accepted defect.

## Anti-goals (a failure even if it works)

- Emojis or a look that does not match the rest of the app.
- A page that hits data912 per user or per ticker, or writes to Supabase on every refresh.
- A list that shows different contents here than in Gráficos.
- A `D`/`C` dollar line listed as if it were a separate CEDEAR.
- A table that scrolls the page sideways on a phone.

## What success looks like

During market hours the user opens Mercado and sees the Panel líder sorted by today's change in MEP. They tap GGAL's Ficha and land on its asset page. Back on Mercado, they create "Bancos", star BMA and GGAL, open Gráficos, and find "Bancos" there with both.

## Left to the builder

- How the full feeds are cached (worker or route).
- The exact peso-line rule for CEDEARs.
- Component split.
- Icons.
- The row-action layout on desktop.
- The empty states and texts.
- The rename and delete affordance for a list in the column. Create, rename and delete must all exist, since Gráficos has them.
