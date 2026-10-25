# Chart space on phones

Objective: on phones (<820px) the Gráficos chart takes the screen: one compact top bar, one bottom tool bar, and indicator panes resizable with a finger. Desktop unchanged.
Branch: feat/chart-space (on fix/legacy-drawings-select: 8ae1f9c, 6e933c1). Delivery: single-pr, the two fixes ship with it (user-approved playback). Runner: vitest (`npx vitest run`), tsc, Chromium probe for touch and layout.

## Specs

- S1 Bigger chart. User: "en la página de gráfico quiero que el gráfico se vea más, hay que buscar la manera de optimizar el espacio, busca la forma que quede todo bien h el gráfico mas grande. Inspírate en la foto, es de tradingview". Approved proposal: chrome above and below the chart goes from about 220px to about 104px on a 390×764 screen (chart about 544px → about 660px). Mockups: https://claude.ai/artifact/CjpUsvAn8iz7R4rmdZmjgx
- S2 Top bar (phone, /trading only): one bar with ☰ (opens the app menu, replaces the "Warren" bar), the active symbol with price and change (tap to change it), and the watchlist star. No second header row.
- S3 Bottom bar (phone): Intervalo (shows the current one, e.g. "1S"; tapping opens 15m 1h 1D 1S 1M), Dibujar (the same named tool list as today), Alerta, Indicadores (the same menu as today), Lista. In the list view the bar offers the way back to the chart.
- S4 While a drawing tool or the alert is armed, the bottom bar shows what to do and "Cancelar", as today but at the bottom.
- S5 Indicator panes. User: "También los indicadores, que ahora en el celu no se puede modificar el tamaño, en desktop si". Approved: drag the separator line with a finger, a wider grab area and a visible grab pill; the height you choose stays when you change symbol.
- S6 Desktop (≥820px) unchanged. Assumption (mine, told to the user): pane sizes are not saved for the next app launch.

## Tasks

- [x] T1 S2 S6 — top bar: shell menu context, Header phone row, AppShell hides its bar on /trading phones — inline — 5382c34 (RED 5 → GREEN)
- [x] T2 S3 S4 S6 — bottom bar: PhoneBar, drawing controls portaled from the chart, armed state over the bar — inline — f30c8b2 (RED 13 → GREEN)
- [x] T3 S5 — separators: touch hit area and grab pill, sizes kept across symbols, Chromium touch probe — inline — 7e9470d, 7c3c48b
- [x] T4 S1 S6 — layout check at 11 widths, phone screenshots, desktop differential, suite, tsc — inline — 87a7fde

## Log

- L1 (2026-10-24) "Antes de subirlo, en la página de gráfico quiero que el gráfico se vea más, hay que buscar la manera de optimizar el espacio, busca la forma que quede todo bien h el gráfico mas grande. Inspírate en la foto, es de tradingview" + "También los indicadores, que ahora en el celu no se puede modificar el tamaño, en desktop si" + "Dale, hacelo lo mejor posible"
- L2 (2026-10-25) Playback with the four mockups sent; user: "Bien". Routes inline: one understood change per task, no writer reason.
- L3 (2026-10-25) T3 probe, real lightweight-charts 5.2.0 in Chromium with CDP touch at 390px: a finger 10px under the separator line drags it 120px with the override (price pane 420 → 300); without it the same gesture moves nothing. The heights already survived a symbol change (indicator panes are only sized when the signature changes): pinned by a test, not new code.
- L4 (2026-10-25) Page probe (scratch clone /tmp/tmp.v1wuW7Pt5P, production build, /preview-chart = the real trading page in AppShell with pathname /trading, /api stubbed), 390×764 touch: top bar 49px, bottom bar 57px, chart 658px (was ~544). One menu button. Intervalo 1D → 1S; Dibujar list opens above the bar; armed overlay covers the whole bar (390×56), Cancelar clears it; Indicadores menu above the bar; ☰ opens the menu, Esc closes it and the focus returns to ☰; Lista leaves only "Gráfico"; separator drag 419/105 → 319/205 and QQQ keeps it; a failed alert's notice ends at 692, above the bar (707). Widths 320-1920: no horizontal overflow, the bar only below 820. Found: the separators' grab pills drew over the open app menu (LWC z-index 50, the chart had no stacking context; the invisible 9px strip already sat there at the baseline) → fixed with `isolate` on the chart box (7c3c48b, RED/GREEN).
- L5 (2026-10-25) Incident, mine: the scratch clones symlinked the workspace's node_modules; with `output: standalone` the build made `.next/standalone/node_modules` a link to it, and the clone's second build cleaned `.next` through the link and emptied the workspace's node_modules. Links removed, `npm ci` restored it (831 packages, drawing-lib patch applied), git unchanged, the user's dev server on 3003 answers 200. Clones now get their own `npm ci`.
- L6 (2026-10-25) Desktop differential, baseline 6e933c1 vs the branch, same stubs, 1920/1280/1024/820: 1024 and 820 identical; 1920 and 1280 differed only in one watchlist row's text antialiasing (LCD → grayscale), caused by `isolate` (identical with it removed live). Isolation now below 820 only (87a7fde): all four identical. Phone probe repeated at 87a7fde: same numbers as L4, the menu covers the separators. Suite 251 files / 2431 tests, tsc clean, lint: no new warnings (3 pre-existing in TradingChart). RDD assess (base 5223933 and 6e933c1): medium, review not due (under_budget). Risk: none.
