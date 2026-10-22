# Redesign of the remaining pages

Objective: bring every remaining page onto the approved visual system, one unit per page, after Resumen (shipped) and Trading (`odd/tasks/trading-chart.md`).
Branch: `feat/trading-chart` (shared with the Trading work; the user merges locally). Delivery: ask-on-risk. Test runner: vitest.
Visual system: `docs/superpowers/specs/2026-10-21-rediseno-ui-design.md` (style, anti-goals, constraints) and the tokens in `src/app/globals.css`.

## Specs

- S1: "el cambio de ui solo lo hiciste del Dashboard que te pasa?" / "sigamos que quedan un montón de cosas!!!!!". Every remaining page adopts the approved style: Operaciones `/history`, Rendimiento `/statistics`, Obligaciones negociables `/ons/**`, Estrategias y alertas `/strategies/**`, Gastos `/cashflow`, plus the two Resumen modals that are still old (`AddTransactionModal`, `ImportModal`).
- S2: anti-goals of the approved spec hold on every touched screen: no glass, glow, decorative gradients, background noise, highlighted words in titles, staggered entrance animations; no content in identical rounded cards (hierarchy from type weight and thin lines); never the old and new systems mixed on one screen.
- S3: accessibility (WCAG 2.2 AA target): measured contrast, visible focus, accessible names, associated labels, gain/loss with sign as well as color, 44 px touch targets on phones, `prefers-reduced-motion`.
- S4: responsive 320–1920 px with no horizontal page scroll, light and dark.
- S5: no calculation, endpoint or data change — interface only.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| P1 | S1-S5 | delegated (parallel unit) | done 1e07793 | `/history` + AddTransactionModal + ImportModal |
| P2 | S1-S5 | delegated (parallel unit) | done | `/statistics` + components/charts + KpiCard, ProvenanceNote, RiskMetricsRow |
| P3 | S1-S5 | delegated (parallel unit) | done | `/ons/**` + components/ons |
| P4 | S1-S5 | delegated (parallel unit) | done | `/strategies/**` + components/strategies |
| P5 | S1-S5 | delegated (parallel unit) | done (commit below) | `/cashflow` |
| P6 | S1, S4 | inline (parent) | done c30ac0c, 94f9b3d, 920c653; suite 1859 PASS; login sweep 8/8 | shared `dialog.tsx`/`button.tsx`, REDESIGNED_PATHS, seam check (full suite + sweep) |

Route evidence: the Writer trigger (a) holds. These are five independent units with disjoint edit surfaces, each several files or more than 100 lines. Shared files (`src/lib/theme.ts`, `src/components/ui/dialog.tsx`, `button.tsx`) belong to the parent and are edited at the end.

## Log

- L1 (2026-10-22, user): "Que tanta pregunta arranca, el cambio de ui solo lo hiciste del Dashboard que te pasa?"
- L2 (2026-10-22, user): "Esto lo hacemos al final. Que no nos bloquee, sigamos que quedan un montón de cosas!!!!!" (Telegram setup deferred to the end).
- L3 (2026-10-22): all six units done and committed. Commits: 7a6381c (P5), c75a6e7 (P2), 1e07793 (P1), 94f9b3d (shell gap on phones), 1c3f83a (P3), 9843fc4 (P4), 920c653 (theme on every route + login rebuild). Full suite 1859 passed, tsc clean.
  - Writers verified each page with stubbed APIs (11 widths × 2 themes). Nothing was checked with the real account.
  - Open, minor: ON helpers print "6,09%" and "USD" while the rest prints "6,09 %" and "US$" (hard-coded in ~20 ON components).
  - Open, minor: setup identification dots in Estrategias use saturated chart colors.
