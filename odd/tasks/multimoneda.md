# Real-time prices and the portfolio in three currencies

Objective: prices at most ~1 min old, and every figure in Pesos / MEP / Cable from a faithful trade record.
Branch: `feat/multimoneda`. Delivery: ask-on-risk. Test runner: vitest. Design: `docs/superpowers/specs/2026-10-22-multimoneda-design.md`.

## Specs

- S1: "quiero bajar el tiempo de recarga de 5mims al mínimos posible, si se puede tiempo real mejor. Para el Dashboard y el gráfico."
- S2: "quiero poder mostrar al usuario el monto en los 3" (pesos, MEP, cable).
- S3: "el usuario tiene que poder cargar bien a cuánto lo compró o vendió, y eso depende de cómo lo compró y el dólar q se usó"
- S4 (approved summary): trades already loaded are converted approximately, and the ones to review are flagged.

- S5 (user, 2026-10-22): "No, acá con mis datos, tené cuidado, pues yo los cargué todos el mismo día, pero no las compré todas las secciones el mismo día. … no te fijes que ya lo cargué … sino fíjate qué día de fecha de compra." → every trade's FX is that of its trade date (`date`), never the load date. Exception, by necessity: reconstructing the typed price of an old CEDEAR row must undo the old form's conversion, which used the FX of its load day (`created_at`).
- S6 (user): "yo en Argentina compro CDRs … cuando vos cargas una compra o una venta, ya tiene el cálculo de para pasarlo a acciones … no sé qué es lo mejor para hacer, esto decímelo vos". Measured: the 124 ACCION rows were all loaded on 2026-03-16 and span trade dates 2022-02-09 to 2026-03-04; 95 have fractional quantity, and 32 of their 35 tickers are in `cedears`. They are CEDEARs already converted to underlying shares in CCL-equivalent USD. Not in `cedears`: DIS, PAM, TGS.

## Stage B decisions (made by the parent at the user's request)

- **New CEDEAR entry.** The user types what the broker shows: CEDEAR count, price per CEDEAR, currency (ARS | MEP | CCL), commission in that currency, and trade date. MEP and CCL of the trade date are pre-filled from `fx_rates` and are editable.
  - The raw values are stored.
  - The engine columns (`quantity` = count / ratio, `price` = USD-CCL per underlying share) are derived from them on the server, using the trade-date FX.
- **Old ACCION rows (124).** `price` is already in the engine unit (USD-CCL per underlying share), so it stays untouched.
  - Add `trade_currency='CCL'`, `trade_quantity=quantity`, `trade_price=price`, and the trade-date MEP/CCL with `fx_source='reconstructed'`.
  - Mark them approximate.
  - DIS, PAM and TGS are flagged for review.
- **Old CEDEAR rows (24).** Reconstruct the typed price with the load-day FX (S5 exception) and the current ratio.
  - Store it with the trade-date FX.
  - Flag for review when `created_at::date - date > 3` or when the reconstructed CEDEAR count is not an integer (tolerance 1e-6).
- **Old ON rows (13).** `trade_currency='MEP'`; trade fields mirror the engine fields; trade-date FX.
- **Ratio changes.** The engine keeps underlying shares, which are invariant to ratio changes. A reconstructed CEDEAR count uses today's ratio and is approximate.
- **Out of stage B.** Cash movements in three currencies, and the engines' per-currency views (stage C).

## Stage C decisions (parent; approved approach "Ok" L3, see design doc)

- **Live peso-line prices.** The worker also fetches data912 `/live/arg_cedears` and `/live/arg_stocks` once per cycle (one GET each, never faster than their 30 s cache) and caches the peso-line `c` per symbol in Redis (`local:{SYMBOL}`, same last-known-price pattern as `price:*`).
  - The ON peso value comes from the D (MEP) price × today's MEP.
- **Value today per position.**
  - `value_ARS`:
    - CEDEAR: `quantity × ratio × local peso price`.
    - ON: `MEP value × MEP_today`.
    - Anything without a local price: `engine USD-CCL value × CCL_today`, flagged as estimated.
  - `value_MEP = value_ARS / MEP_today`; `value_CCL = value_ARS / CCL_today`.
  - Today's MEP and CCL are the latest `fx_rates` row (`getFxRate(today)`).
- **Cost per lot**, from the trade record of each row:
  - `ARS` trade: `trade_price × trade_quantity` (+ commission).
  - `MEP` trade: that × `fx_mep`.
  - `CCL` / reconstructed: engine `price × |quantity| × fx_ccl` (+ commission × fx_ccl).
  - Then `cost_MEP = cost_ARS / fx_mep` and `cost_CCL = cost_ARS / fx_ccl` of the trade.
- **Average cost per currency.** A moving weighted average with Cocos semantics: a sale leaves it unchanged, and a full close resets it.
- **Realized result per currency.** The sale proceeds converted with the sale's FX. Dividends and coupons are converted with the FX of their date.
- **Cash.** `cash_movements` has no currency. The balance stays in the engine unit (USD-CCL): ARS = balance × CCL_today, MEP = ARS / MEP_today. Shown with a note. Not stored differently.
- **UI.**
  - A selector "Pesos · Dólar MEP · Dólar cable" in the Resumen header. The default is MEP, remembered per viewer in localStorage.
  - Every figure (total, day change where available, holdings value, cost, result, distribution) follows the selector.
  - A one-line note explains that results differ between currencies because of the dollar.
  - Estimated values are labelled.
- **Unchanged:** the existing USD engine numbers stay available, and no stored data changes.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| A1 | S1 | inline | done | worker 1 min, dashboard 30 s, quote 15 s cached, candles 30 s; RED→GREEN worker-startup + quote cache |
| A2 | S2, S3 | inline | done 6b4b208, migration 043 applied, deployed | `fx_rates` table (MEP/CCL daily from argentinadatos), backfill and daily ingest. Risk item 1 (new table; DB write needs OK) |
| B1 | S3, S5 | delegated (context backstop) | done 65622c6, 5116b2f, a371405 (044 NOT applied) | migration 044 (additive nullable columns), `/api/fx` route, server-side derivation in `/api/transactions`, new CEDEAR form |
| B2 | S4, S5, S6 | delegated (same writer, after B1) | done ac58c9a, 293a798, 5ea6c89; independent verifier: no blockers, 6 advisories | reconstruction as a reviewed SQL/TS step (dry run first), review list in Operaciones. Risk item 1: changes stored rows; backup and user OK before applying |
| C1 | S2 | delegated (context backstop) | done 3262be8 | local peso prices in the worker + pure per-currency valuation/cost module with tests |
| C2 | S2 | delegated (same writer, after C1) | done 0aea2ab, c8aac7b; parent fixes b30b98b + test | /api/positions exposes the three views; Resumen selector and figures |

## Log

- L1 (2026-10-22, user): "Ahí va quedando mucho mejor. Ahora quiero hacer algunas mejoras, primero quiero bajar el tiempo de recarga de 5mims al mínimos posible, si se puede tiempo real mejor. Para el Dashboard y el gráfico. https://data912.com/live/arg_cedears"
- L2 (2026-10-22, user): "Banca ya que estamo, quiero hacerlo bien como lo hacen los brokers En argentina todo esto es un quilombo, porque podes comprar activos con dólares, pesos o cable. Podrías investigar cuál es la mejor manera para hacerlo. Porque quiero poder mostrar al usuario el monto en los 3. Pero para eso es el usuario tiene que poder cargar bien a cuánto lo compró o vendió, y eso depende de cómo lo compró y el dólar q se usó"
- L3 (2026-10-22, user): "Ok" to the plain summary (stages A → B → C).
- L4 (2026-10-22, user): "No, acá con mis datos, tené cuidado, pues yo los cargué todos el mismo día, pero no las compré todas las secciones el mismo día. Los fui comprando a lo largo de un plazo, capaz no puse bien el tiempo. O sea, si querés, puedo buscar todos los datos y reconstruirlo, pero vamos a tardar mucho tiempo para hacerlo. Fíjate igual bien si también las fechas de carga, porque capaz también puse como que qué día la compré. O sea, no te fijes solo, o sea, no te fijes que ya lo cargué, no muchas veces, sino fíjate qué día de fecha de compra."
- L5 (2026-10-22, user): "Es que lo que pasa es que yo en Argentina compro CDRs, pero si vos te das cuenta en el sistema, cuando vos cargas una compra o una venta, ya tiene el cálculo de para pasarlo a acciones, que todas tienen con coma. Entonces nunca son CDRs, son siempre acciones. Yo traslado siempre acciones. O sea, no sé qué es lo mejor para hacer, esto decímelo vos, investigalo, pero yo siempre cambié, uso la cuenta ahí y lo migro a acciones. Fíjate igual."
- L6: stage A deployed (CI 39771591478 green); fx_rates loaded at worker start: CCL 5042 days (2013-01-02..2026-10-22), MEP 2916 days (2018-10-29..2026-10-22).
- L7: stage B built in 6 commits; suite 1936 PASS, tsc clean. Writer's decisions to surface: integer tolerance max(1e-6, ratio×5e-7) because quantity is numeric(18,6); old USD-CEDEAR commissions were stored in MEP as if CCL (pre-existing, not fixed). Live RPC checked: 1 overload, 10 args.
- L8: independent verifier, no blockers.
  - Live RPC body identical to 030 (whitespace-stripped md5).
  - Old call paths: same data hash before and after 044.
  - Backfill function all-or-nothing and service_role only.
  - Real dry run, expected: 161 planned / 0 skipped; ACCION 124, CEDEAR 24, ON 13; CCL 124, MEP 33, ARS 4; needs_review 8 (DIS×2, TGS×2, PAM×2, VST loaded 6 days late, MSFT non-integer 297.9 CEDEARs). The CEDEAR round-trip is exact.
  - Advisories: A1 load day is the UTC date; A2 apply 044 before deploying; A3 float noise in FX; A4/A5 FX edit edge cases; A6 old MEP commission (pre-existing, all real commissions are 0).
- L9 (2026-10-22): 044 applied in two parts.
  - Columns via MCP.
  - RPC + backfill function pasted by the user in the SQL Editor; the MCP UI froze three times on the long function.
  - Live body is identical to the verified file (comment/whitespace-stripped md5 d773443d…).
  - Backfill applied: 161 rows in one transaction; backup in trade-record-backup-2026-10-22T16-10-58-617Z.json (gitignored). DB check: 0 missing FX, 0 FX after trade date, 8 needs_review.
  - Stage B pushed: master bd1f385..3a24dd1.
- L10 (2026-10-22): stage C built.
  - Suite 1984 PASS. Browser check at 320/375/1440 × light/dark passes.
  - Real holdings: all 14 are CEDEARs with a data912 peso price (none estimated).
  - Parent fixed the wrapping of long peso amounts. Note: b30b98b was committed while one test failed (the grep in the chain hid the exit code); fixed in the next commit.
