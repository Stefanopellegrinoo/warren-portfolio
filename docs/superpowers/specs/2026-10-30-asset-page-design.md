# Asset page: financial data for any asset — design

Date: 2026-10-30. Born from a review of github.com/ErTasselli/OpenTerminal. The user approved the "Números" mockups for mobile and desktop with "me gusta hacelo". Screenshots: `assets/2026-10-30-asset-page-numeros-mobile.png` and `assets/2026-10-30-asset-page-numeros-desktop.png`.

## Intent

The user's words: "Lo que más me importa son los datos financieros y demás, como balances, etc., de cada uno de los activos, esto me parece fundamental, tiene que tener su página bien clara, en donde se entienda bien cada dato, que sea fácil de entender, bien legible. Pero también quiero que se pueda buscar la info de cualquier activo que el usuario quiera."

What a reader wants in the first ten seconds: "si le está yendo bien como empresa y si está cara, ratios, capaz poder compararla con otras empresas".

Who reads it: "para cualquier usuario, que no sepa nada de balances, hasta gente más avanzada". The app serves many users. Nothing here is specific to one account.

History matters as much as today's value: "Quiero más datos, tipo todos los financieros de los últimos Q de hace varios años para ver el cambio, lo mismo con los demás datos". The user also showed TradingView's Estadísticas screen (key stats, valuation, profitability, liquidity, solvency, per share) and asked "¿todos estos datos podemos tener?". The answer was yes for all but a few. See "Metric catalog".

Today the app has no page about an asset. Tickers appear in Resumen, the watchlist, the trading chart and Operaciones, but none of them shows what the company is or how it is doing.

## Goals

1. **One page per asset**, reachable for any asset, held or not:
   - from a search box in the app shell, where `/` focuses it on desktop;
   - from every ticker the app already shows (Resumen holdings, watchlist rows, the trading chart header, Operaciones).
2. **Four tabs: Resumen · Números · Comparar · Noticias.** The user picked the tabbed, broker-like layout ("B · Pestañas, como un broker").
3. **Números is built as approved in the mockups:**
   - Groups like TradingView's: Estadísticas clave, Valoración (with an "Esperados por analistas, próximo año" sub-block), Rentabilidad, Liquidez, Solvencia, Por acción (US$), Analistas y riesgo.
   - Every row shows today's value and a "?" (an inline popover on mobile, a hover tooltip on desktop). The popover explains the metric in plain Spanish with this company's number and its peers' numbers, e.g. "Cuántos años de ganancias estás pagando. Con 45, si MercadoLibre ganara siempre lo mismo que este año, tardaría 45 años en devolverte lo que pagás por la acción. Más alto = más cara, salvo que la empresa crezca rápido. Sus parecidas: Amazon 19,6 · Sea 29,0 · eBay 26,5".
   - Tapping a row opens that metric's history:
     - On mobile it is a full screen with "‹ Números".
     - On desktop it is a sticky panel to the right of the list, with the list in two columns and "Por acción" spanning both.
     - The history panel holds: the value with its change against a year earlier, a range selector (2 / 5 / 8 años), a period selector (Trimestral / Últimos 12 meses / Anual), a line chart with the best point marked and a hover value, a "¿Qué es?" card, a "¿Cómo viene?" card, and "Contra sus parecidas" bars with this company highlighted.
4. **Every number on the page means the same thing everywhere.** For any one metric, the value in the list, every point of its history chart, and the same metric for each peer come from:
   - one source,
   - the same pure function,
   - the same inputs.

   The chart ends in a "hoy" point equal to the list value: latest twelve months with today's price. The earlier points are quarter or year ends with the price of that day. A list value that differs from its chart's "hoy" point is a defect. See "One computation" for which source each metric uses.
5. **Full statements for those who want them.** A "Balances completos" view lists Resultados / Balance / Flujo de caja as a table, with one row per line item and one column per quarter or year, scrolling horizontally inside its container. Each cell carries ▲▼ against the same period a year earlier. Tapping a row opens its chart. This was the "Planilla, como un balance" mockup. It sits behind a link at the end of Números, not as a fifth tab. My call.
6. **Comparar**: the company and its peers side by side on the key ratios (P/E, P/E esperado, crecimiento de ventas, margen neto, ROE, deuda/patrimonio, capitalización), with this company highlighted.
   - Peers default to the same industry in the same market, by market cap. The user can add or remove any ticker.
   - Not mocked. Built in the Números visual language. My call.
7. **Noticias**: recent headlines about the asset, Spanish first, newest first, de-duplicated by title. Each one shows source and age and links out.
8. **Resumen** answers the two first-ten-seconds questions in plain words, from data, never as advice:
   - "¿Le va bien como empresa?": sales growth over the last 12 months, whether it makes money, and the direction of its net margin.
   - "¿Está cara?": P/E against its peers' median and against its own 5-year median.
   - It also shows the 52-week range, the analysts' average target and count, the next earnings date with the last four quarters' estimate against actual, and sector · industry · country · employees.
   - The two answers came from mockup A ("Respuestas arriba"). The user picked B for the overall layout, so here they live inside Resumen. My call.
9. **Search covers every asset the app knows, and assets without a balance sheet get a page too:**
   - ETFs: composition, sectors and returns; no Números.
   - Crypto: price and news.
   - ONs and bonds: the search sends them to the existing `/ons/[isin]` page.

## Non-goals

- No buy/sell advice, ratings of our own, or "barata/cara" verdicts beyond the factual comparisons in goal 8.
- No AI summaries, options chains, insider trades, short volume or order books (OpenTerminal has them; out of scope).
- No alerts on fundamentals. That would be a later project.
- No changes to the ON pages.

## Anti-goals

- Numbers that disagree within the page (list vs chart vs peers), or that silently mix currencies. The GGAL ADR on Yahoo divides a USD price by ARS sales and gets P/S 0,00097.
- Jargon without its "?" explanation.
- Any new table or write in Supabase. Its Disk IO already took the app down once (see `odd/tasks/supabase-efficiency.md`). Everything here is market data shared by all users and lives in Redis with a TTL.
- A page that breaks when one source breaks. Each section degrades on its own, with a clear message, and serves the last good data when it has it.
- Personal portfolio data in the repo, tests, commits or PRs (public repo). Fixtures may use public company data.

## Metric catalog

All of these are verified live on 2026-10-30 against NASDAQ:MELI and BCBA:YPFD unless noted.

- **Estadísticas clave**: acciones en circulación, capital flotante, empleados.
  - Dropped: número de accionistas. It only exists for US companies, and it counts holders of record: 198 for MELI. That misleads.
- **Valoración**: P/E, precio/ventas, precio/flujo de caja, precio/valor libro, valor de empresa, VE/EBITDA, VE/ventas, VE/EBIT.
  - Esperados: P/E, precio/ventas, precio/valor libro, VE/EBITDA.
  - VE/ventas esperado = VE / estimated next-year sales, which is available.
  - No VE/EBIT esperado: there is no free EBIT estimate.
- **Rentabilidad**: ROA, ROE, ROIC, margen bruto, operativo, EBITDA, neto.
- **Liquidez**: liquidez inmediata, corriente, rotación de inventario, rotación de activos.
- **Solvencia**: deuda/activos, deuda/patrimonio, deuda LP/activos, deuda LP/patrimonio.
- **Por acción**: ventas, flujo de caja operativo, flujo de caja libre, EBIT, EBITDA, valor libro, valor libro tangible, caja, deuda, capital de trabajo, CapEx, ganancia (EPS).
  - Dropped: valor liquidativo. It is a fund metric.
- **Analistas y riesgo**: precio objetivo promedio (with the analyst count), beta.

Forward ("esperado") metrics and the analysts' target have no history. Their row has no chart. It shows the value and the "?" only.

## Data sources (verified 2026-10-29/30)

| Source | What it gives | Limits |
|---|---|---|
| TradingView scanner, `POST scanner.tradingview.com/{america\|argentina}/scan` | Today's value of every catalog metric. Forward estimates. 32 quarters (`*_fq_h`) and 20 years (`*_fy_h`) of revenue, net income, gross profit, EBITDA, total assets, total debt, free cash flow and diluted EPS, for US and BYMA alike. Many tickers per request. Peers by industry filter. | Unofficial, no key. History has no per-item dates: only `fiscal_period_end_fq` for the latest quarter, so step back 3 months per item (verified: MELI's 2025 quarters sum to the annual 28.893 M). No history for equity, liabilities, cash or operating income. |
| Yahoo, `yahoo-finance2` 3.13.2 (installed), `fundamentalsTimeSeries` | Complete statements: about 50–90 lines each for income, balance and cash flow. Also profile, analysts, earnings dates and estimate vs actual, ETF holdings, sectors and returns, English news. | About 5 annual periods and 5–6 quarters only. `quoteSummary` statement modules are empty since Nov 2024. ADRs of Argentine companies mix ARS statements with a USD price. |
| SEC companyfacts (official XBRL, `data.sec.gov`) | The full quarterly statements since about 2009 for companies filing 10-Q. That is about 6 of 10 CEDEAR underlyings in a sample of 40. MELI has 139 concepts with 20 or more quarters. | US 10-Q filers only. 20-F filers (Itaú, Toyota, Sea, NIO…) are annual only. About 4 MB per company. Q4 must be derived as the year minus nine months. Concept names vary per company. Requires a `User-Agent` with an app name and contact email. |
| Google News RSS, `hl=es-419&gl=AR` | Spanish headlines. 91 items for "Grupo Financiero Galicia". | RSS (XML), unofficial. |
| App's own CCL history (`src/lib/fx-rates.ts`, `historical-prices.ts` `toUsd`) and price history (`bars-cache.ts`) | Prices for the ratio history and the ARS→USD conversion. | — |

**One computation (my call, after the builder check).** A pure module computes every metric from normalized statements plus a price. Its inputs are fixed **per metric, never per company or per period**. Sources disagree on definitions: MELI's total debt at December 2025 is 15.163 M on TradingView and 11.390 M on Yahoo. So one metric never mixes sources.

- **Group T, TradingView history.** These metrics need only TradingView's eight history lines plus a price:
  - ventas, ganancia neta, ganancia bruta, EBITDA, flujo de caja libre, EPS, activos, deuda (amounts);
  - margen bruto, margen EBITDA, margen neto;
  - P/E, precio/ventas;
  - ROA, deuda/activos;
  - ventas, EBITDA, EPS, deuda and flujo de caja libre per share.

  For these the company, its peers and every period come from TradingView. That gives 8 years of quarters, also for BYMA, and peers arrive in one batch request.
- **Group Y, Yahoo `fundamentalsTimeSeries`.** Everything else needs lines TradingView has no history for (patrimonio, caja, pasivos, resultado operativo, activo y pasivo corriente, inventario):
  - ROE, ROIC, margen operativo;
  - liquidez, solvencia except deuda/activos;
  - precio/valor libro, precio/flujo de caja, valor de empresa and its ratios;
  - valor libro, caja and capital de trabajo per share.

  For these the company, its peers and every period come from Yahoo. History is 5 years annual and 6 quarters. The chart says "historia desde 2021". Each peer costs one cached Yahoo request.
- **Forward metrics, analysts' target, shares, float, employees**: today's TradingView value, no history.
- **Balances completos** follows the same rule per row. A row comes from one source across all its columns:
  - SEC rows (since about 2009) for US 10-Q filers;
  - otherwise Yahoo rows (5 years and 6 quarters);
  - plus a TradingView row for each of its eight lines when the user picks the 8-year range.

  SEC enters only here, so it can ship last.

**Ratios do not use per-share prices for foreign listings.** P/E = market cap / net income, P/S = market cap / sales, and so on. That way ADR ratios (TSM, BABA, ITUB) never matter.

Statements in another currency are converted at the exchange rate of each period's end. Yahoo serves FX history (`TWD=X`, `CNY=X`, `BRL=X`, `JPY=X`) through the same chart API the app already uses. Per-share values are per listed unit. The implied units are market cap / price.

Amounts show in the currency the reader is shown at the top of the tab, labeled.

**Argentine companies**:
- A plain ticker of an Argentine ADR (GGAL, YPF, BMA, PAM…) uses its BYMA listing (`BCBA:X`) for Números. The page says so ("Datos de Grupo Financiero Galicia en BYMA").
- **Amounts and their growth show in dollars CCL.** The user chose "Dólares CCL" on 2026-10-30. Each period's ARS amount is converted at the CCL of that period's end, using the app's own CCL history. So inflation never reads as growth, and the numbers compare directly with CEDEARs.
- Ratios stay as they are: they are currency-neutral, with an ARS price over ARS statements.
- No ARS toggle.
- The builder must check whether each source's ARS history is as reported or restated under IAS 29, before converting it. Converting already-restated pesos at an old CCL would be wrong.

**Peers (my call).** By default: up to 5 companies of the same industry and market, by market cap. When a BYMA industry has fewer than 3, it fills from the same industry in the US market (ratios are currency-neutral).

Editing peers in Comparar changes the peer set for the whole page while it is open: Comparar, "Contra sus parecidas", the "?" popovers and Resumen's peers median. It lives in the URL (`?vs=AMZN,SE`), so it is shareable and needs no storage. Leaving the page drops it.

## Which assets get a page (my call, after the builder check)

- **Full page** for listings in TradingView's `america` and `argentina` markets: US listings, ADRs, CEDEAR underlyings and BYMA stocks. Also ETFs in those markets, crypto the app already prices (Binance), and ONs/bonds by redirect.
- **Anything else search returns** (a Tokyo- or London-only listing, say) shows the name and price with "Todavía no tenemos datos financieros de este mercado". It writes no fundamentals keys.
- **A ticker is valid for cache keys** only after it resolves through the existing `resolveTickerIdentity`, which is already cached for 7 days, and is in one of the markets above. Free text never reaches a fundamentals key.

## Constraints

- **Redis only.** Redis runs `noeviction` with `maxmemory 128mb` (`docker-compose.yml`) and also holds durable data such as alert definitions. So:
  - every key needs a TTL;
  - keys come only from valid tickers (see above);
  - each company's cached payload holds only the normalized lines and metrics the page uses, never a raw response. A raw SEC companyfacts response is about 4 MB. Target 30 KB or less per company per source. Suggested TTLs:
  - statements: about 24 h, since they change quarterly;
  - today's values during market hours: about 15 min;
  - news: about 30 min;
  - peers: about 24 h.
- Per-user rate limit on the new API routes, using the existing `rateLimit` helper.
- **Ticker forms.**
  - Plain tickers (CEDEARs and US listings) use the underlying company.
  - `BCBA:X` uses BYMA: TradingView `BCBA:X`, Yahoo `X.BA`, via `normalizeTickerForYahoo`.
  - Ratios use a price and statements in the same currency. For BYMA that is the ARS price with ARS statements.
- **Responsive.** Measure at 11 widths (320–1920) with no horizontal page scroll. The only exception is the statements table scrolling inside its own container. iPhone PWA first.
- **Look.** Use the app's tokens, light and dark (`src/app/globals.css`): IBM Plex Sans, IBM Plex Mono for numbers, Spanish number formatting (1.660,13). UI copy is in Spanish.
- Unofficial sources can change shape. Parse defensively and fail per section.

## Left to the builder

- Route path and naming, component structure, API shape, exact cache keys and TTLs.
- The chart implementation: the mockups used inline SVG; `lightweight-charts` and `recharts` are installed.
- The SEC concept mapping and the Q4 derivation.
- XML parsing for RSS.
- How the "?" copy is stored.
- Exact wording of every "?" and "¿Cómo viene?" text, within the rules above. "¿Cómo viene?" states only what the numbers show. No causes the data cannot prove.
- Delivery order. Suggestion: search + page shell + Números on TradingView/Yahoo first; then history and Balances completos (adding SEC); then Comparar, Noticias, Resumen.
