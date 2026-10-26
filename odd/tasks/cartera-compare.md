# Cartera list, Mi cartera chart, compare any assets
Branch `feat/cartera-compare` (on top of `fix/trade-markers-mobile`). Delivery: single PR, ask-on-risk. Runner: vitest.
Design: docs/superpowers/specs/2026-10-26-cartera-compare-design.md. Plan: docs/superpowers/plans/2026-10-26-cartera-compare.md.

## Specs
- S1 "Que una lista por defecto sea la cartera de acciones" — automatic Cartera list, first, held stocks + CEDEARs, not editable (design Goals 1–2).
- S2 "Pero mi cartera se va a poder ver como un gráfico tipo de una acción?" — Mi cartera in the trading chart as a line (design Goal 3).
- S3 "Y después voy a poder compararlo contra otro activo? Esto de comprar también quiero poder hacerlo entre cualquier activo" / "Compara rendimientos, contra etfs" — + Comparar on every chart, % scale, USD (design Goals 4–5, anti-goals).

## Tasks
- T1 S2,S3 compare-series endpoint — inline — pending
- T2 S3 pure compare helpers — inline — pending
- T3 S2 Mi cartera as a chart — inline — pending
- T4 S1 Cartera list — inline — pending
- T5 S3 compare on any chart — inline — pending
- T6 S1–S3 page wiring + checks + UI probe — inline — pending

## Log
- L1 (2026-10-25) "De paso quiero que agregues que una de la listas por defecto sea la cartera, entiendes? Que una lista por defecto sea la cartera de acciones y que se pueda hacer gráfico para comparar contra otros activos a elección"
- L2 (2026-10-26) Mockups approved: "Está bien". Design approved: "Si".
- L3 (2026-10-26) "Pero mi cartera se va a poder ver como un gráfico tipo de una acción? Y después voy a poder compararlo contra otro activo? Esto de comprar también quiero poder hacerlo entre cualquier activo" → revised design approved "Si"; my calls approved "Si"; execution: inline (Native).
