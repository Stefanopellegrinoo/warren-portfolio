# Real-time prices and the portfolio in three currencies

Objective: prices at most ~1 min old, and every figure in Pesos / MEP / Cable from a faithful trade record.
Branch: `feat/multimoneda`. Delivery: ask-on-risk. Test runner: vitest. Design: `docs/superpowers/specs/2026-10-22-multimoneda-design.md`.

## Specs

- S1: "quiero bajar el tiempo de recarga de 5mims al mínimos posible, si se puede tiempo real mejor. Para el Dashboard y el gráfico."
- S2: "quiero poder mostrar al usuario el monto en los 3" (pesos, MEP, cable).
- S3: "el usuario tiene que poder cargar bien a cuánto lo compró o vendió, y eso depende de cómo lo compró y el dólar q se usó"
- S4 (approved summary): trades already loaded are converted approximately, and the ones to review are flagged.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| A1 | S1 | inline | done | worker 1 min, dashboard 30 s, quote 15 s cached, candles 30 s; RED→GREEN worker-startup + quote cache |
| A2 | S2, S3 | inline | todo | `fx_rates` table (MEP/CCL daily from argentinadatos), backfill and daily ingest. Risk item 1 (new table; DB write needs OK) |
| B | S3, S4 | tbd | todo | faithful trade record + form + reconstruction |
| C | S2 | tbd | todo | per-currency engines + selector |

## Log

- L1 (2026-10-22, user): "Ahí va quedando mucho mejor. Ahora quiero hacer algunas mejoras, primero quiero bajar el tiempo de recarga de 5mims al mínimos posible, si se puede tiempo real mejor. Para el Dashboard y el gráfico. https://data912.com/live/arg_cedears"
- L2 (2026-10-22, user): "Banca ya que estamo, quiero hacerlo bien como lo hacen los brokers En argentina todo esto es un quilombo, porque podes comprar activos con dólares, pesos o cable. Podrías investigar cuál es la mejor manera para hacerlo. Porque quiero poder mostrar al usuario el monto en los 3. Pero para eso es el usuario tiene que poder cargar bien a cuánto lo compró o vendió, y eso depende de cómo lo compró y el dólar q se usó"
- L3 (2026-10-22, user): "Ok" to the plain summary (stages A → B → C).
