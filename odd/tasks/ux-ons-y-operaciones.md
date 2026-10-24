# UX project 2: ONs that read at a glance, and operation modals that never lose work

Objective: every ONs page answers its main question first and tucks the rest away; the add-operation and import modals are safe and clear on a phone.
Branch: `feat/ux-ons` (stacked on `feat/ux-base`). Delivery: ask-on-risk; work-unit commits, PR slicing decided at push time. Test runner: vitest (`npm test`, `npm run type-check`, `npm run lint`).
Visual system: `docs/superpowers/specs/2026-10-21-rediseno-ui-design.md` and the tokens in `src/app/globals.css`; ON primitives in `src/components/ons/ui.tsx`.

## Specs

User's words in L1-L2. Evidence: the 2026-10-23 ONs audit (engram `ux/audit-2026-10-23`).

- S1 (ONs as a section): "Fíjate más que nada en la página de ONS, que es todo un choclo, es un quilombo, está todo junto, está todo marea al usuario" → the ONs section has three tabs, **Mis ONs** (`/ons/mi-cartera`), **Explorar** (`/ons`) and **Carteras de prueba** (`/ons/carteras`), shown on those three pages; the menu entry opens Mis ONs and stays highlighted on every `/ons/**` page. Drill-down pages (`/ons/[isin]`, `/ons/carteras/[id]`) keep a back link instead of tabs.
- S2 (Mis ONs): the first thing on the page answers "¿cuándo cobro y cuánto?": the next payment (date, USD, which ONs), what comes in the next 12 months, and the market value. Right after: anything that needs the user's action (missing payments), then the next payments as a short list, then the user's ONs (each opens its detail page). Calendar, portfolio analysis (TIR, duration, average life, income per year, maturity ladder, issuer and plaza concentration) are collapsed sections. Paid payments and corrections stay at the end.
- S3 (ON detail): the top answers "¿qué es, cuánto rinde, cuándo paga?" in at most five facts (price, TIR, maturity, next payment, minimum lot), and the simulator ("¿Cuánto cobrás?") comes right after, with its payments in USD. Technical metrics, the % schedule, issue terms, call options, taxes and sources are collapsed sections, each shown once. One TIR in the facts; the BYMA TIR only inside the technical data.
- S4 (Explorer): search is always visible; the other filters are behind one "Filtros" control that shows how many are active. The list shows one TIR per bond. The desktop table defaults to the columns a retail investor chooses by (ON, maturity, price, TIR, next payment, volume); the rest appear with "Más columnas". On phones the card shows whatever the list is sorted by. Status notices collapse to one line; sources go into a collapsed section.
- S5 (test portfolios): the list shows existing portfolios before the create form. The builder shows the result summary first, then its ONs, then the add form; renaming sits behind a button; every error appears next to the action that caused it; a failed catalog load says so and offers a retry.
- S6 (plain language): no explanation lives only in a `title=` tooltip (they never show on touch). Each ONs page has a collapsed "¿Qué significa cada dato?" glossary in plain Spanish.
- S7 (operation modals): "También fíjate los modales para agregar operaciones" → the add-operation and import modals never lose what the user typed to a stray tap or Escape: with unsaved data, closing asks to discard inside the modal. Saving shows a confirmation of what was saved. On phones the modal fills the screen and the primary button stays reachable. A failed catalog load is visible. Import: "Reemplazar todo" asks a second confirmation; per-line errors are readable as a list.
- S8 (quality bar, from project 1): plain Spanish with the app's voseo; 320–1920 px with no horizontal page scroll, light and dark; 44 px touch targets on phones; numbers unchanged (no calculation in `src/lib` changes; only what is shown and where).

## Tasks

- [x] T1 · S1, S6 · inline · shared primitives (`Disclosure`, `OnsTabs`, `Glossary`, `Bars`) and the menu entry · `590f3f9` (RED 3 → GREEN)
- [x] T2 · S2 · inline · Mis ONs (summary, missing payments, next payments, your ONs, collapsed calendar and analysis; paid payments on two lines, five at a time) · `ad1f097` (RED 4+2 → GREEN) · 11 widths × 2 themes, no overflow
- [x] T3 · S3, S6 · delegated (writer trigger (a): parallel with T4-T6, disjoint surfaces) · ON detail and simulator · `8546eed` (63 tests)
- [x] T4 · S4, S6 · delegated (writer trigger (a)) · explorer · `b5576a4` (28 + 16 filter tests; old URLs parse the same)
- [x] T5 · S5 · delegated (writer trigger (a)) · test portfolios · `c304d29`, held mode removed `647179f`
- [x] T6 · S7 · delegated (writer trigger (a)) · add-operation and import modals · `a9a4b34` (RED 12/19 + 5/6 → GREEN; request bodies pinned)
- [x] T7 · S8 · inline · integration sweep and fixes · toast close tap area `see log L5`

## Log

- L1 (2026-10-23, user): first request of project 1, verbatim in `odd/tasks/ux-base-global.md` L1 ("Fíjate más que nada en la página de ONS, que es todo un choclo...").
- L2 (2026-10-24, user, after "¿Commiteo esta base y arranco con ONs, que es donde el cambio se va a ver?"): "Dale y no frenes. También fíjate los modales para agregar operaciones"
- L3: decisions taken without stopping, per L2 (marked "decided by me" for the user to review): the ONs menu entry opens Mis ONs; three tabs; collapsed sections use native `<details>`; the native review consent for the `feat/ux-base` slice is presented at the end of the turn instead of mid-work.
- L4: T2 visual check on a preview with 7 ONs computed by the real `analyzeOn`/`buildMyOnPortfolio`: the paid-payment rows wrapped unevenly on phones and the history would grow without bound; rows now read on two aligned lines and page five at a time (same pattern as the Resumen movements). A type error (`concept(next)`) slipped past vitest, which does not type-check: caught by `tsc` before the commit.
- L5: T7 integration sweep inside the real app shell (the writers' previews for T3 and T5 had no sidebar): Mis ONs, explorer, detail, test-portfolio list and builder × 13 widths (320-1920, plus 820 and 1080) × 2 themes, with every collapsed section closed and open: no horizontal overflow, no page errors. Toast close button: visible 20 px, tap area 44 px via `::after`, checked by tapping 9 px outside it. Final: 210 files / 2097 tests, type-check clean, lint 0 errors (38 warnings, same as base). Writer findings worth keeping: the import worker returns `{ success: false }` instead of throwing, so failed imports arrive as `completed` and their line errors were never shown (now listed); the add-operation default date was UTC (tomorrow after 21:00), now `argentinaDate()`; the default simulation used to open on "Mínimo: VN …" when the minimum lot cost more than USD 1.000.
- L6 (2026-10-24, user, after testing on the iPhone): "todo bien, menos en los modales los inputsw de fechas, salen de la pantalla". iOS sizes a native date control to itself and ignores `width: 100%`; Chromium never showed it, so the T7 sweep missed it. Fixed for every date field in `globals.css` (`min-width: 0`, plus `appearance: none` only on iOS via `@supports (-webkit-touch-callout: none)`), commit 0d7d860. The user confirmed on the iPhone: "perfecto".
