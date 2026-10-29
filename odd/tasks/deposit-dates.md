# Deposit dates: any user can fix deposits recorded after the purchases they paid
Branch `feat/deposit-dates` (stacked on `fix/statistics-numbers` a1fd719). Delivery: ask-on-risk, chained after the statistics PRs. Runner: vitest (`npm test`, `npm run type-check`).

## Specs

The user's rule (2026-10-29): "Quiero que queden bien mis datos asi puedo usar la app, pero quiero que entiendas que la app no puede estar pensada solo para mi caso si quiero mas usuarios la usen, si esta solo pensada para mi lo suyo no va a estaqr bien". Approved as proposed ("dale, hacelo así"):

- S1 (detect): "La app lo detecta y lo ofrece: a cualquier usuario cuyas compras quedaron antes de sus depósitos le aparece una vez \"Revisar fechas de depósitos\"."
- S2 (proposal first): "Muestra la propuesta antes de tocar nada: \"Tu depósito del 31/03/2026 pagó compras desde el 09/02/2022: ¿lo repartimos en esas fechas?\". Ves el detalle y podés corregir cada fecha si sabés la real."
- S3 (apply on confirmation): "Recién al confirmar, guarda. Lo hace de una sola vez, de forma atómica, y el total depositado no cambia. Desde ahí no hay nada que acomodar y el aviso desaparece solo."
- S4 (own account through the flow): "Tus datos se arreglan usando ese mismo flujo, desde la app. Así lo probamos de verdad antes de que lo use otro, en vez de un SQL hecho a mano por mí." With a backup first.
- S5 (quiet notice): "El aviso discreto con ⓘ queda solo para quien todavía no revisó." — the derived-series adjustment note (statistics-truth S10) becomes a short line with an (i) whose detail opens on hover or tap.

Assumptions: the proposal is `fundPurchases` (`src/lib/derive-history.ts`) on the user's own movements, the same computation the statistics already use; an edited date can only move a part earlier than its original deposit and never after today; amounts are not edited (the total deposited never changes).

## Tasks

- T1 S5 — quiet deposit notice with (i) (statistics risk row and evolution chart) — inline — in progress
- T2 S2 — proposal: per original deposit, the dated parts it funds (pure, from fundPurchases) + GET route — inline — pending (waiting for the write-path map)
- T3 S3 — atomic apply: RPC migration + POST route with ownership and amount/date validation + cache invalidation — inline — pending; high risk items 1 (changes stored data) and 2 (RPC security) → independent verifier
- T4 S1,S2 — review dialog (editable dates) and the entry points — inline — pending
- T5 S4 — backup, the user applies the migration, the user runs the flow on their account, verify with SELECT — with the user — pending

## Log

- L1 (2026-10-29) "pero porque esto sigue estnado Algunos depósitos estaban cargados después de las compras que pagaron: para medir, US$ 154.323,07 se toman como depositados el día de esas compras, desde el 09/02/2022. El total depositado no cam"
- L2 (2026-10-29) "Quiero que queden bien mis datos asi puedo usar la app, pero quiero que entiendas que la app no puede estar pensada solo para mi caso si quiero mas usuarios la usen, si esta solo pensada para mi lo suyo no va a estaqr bien"
- L3 (2026-10-29) "dale, hacelo así"
