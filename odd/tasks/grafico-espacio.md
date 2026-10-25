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

- [ ] T1 S2 S6 — top bar: shell menu context, Header phone row, AppShell hides its bar on /trading phones — inline
- [ ] T2 S3 S4 S6 — bottom bar: PhoneBar, drawing controls portaled from the chart, armed state over the bar — inline
- [ ] T3 S5 — separators: touch hit area and grab pill, sizes kept across symbols, Chromium touch probe — inline
- [ ] T4 S1 — layout check at 11 widths, phone screenshots, suite, tsc — inline

## Log

- L1 (2026-10-24) "Antes de subirlo, en la página de gráfico quiero que el gráfico se vea más, hay que buscar la manera de optimizar el espacio, busca la forma que quede todo bien h el gráfico mas grande. Inspírate en la foto, es de tradingview" + "También los indicadores, que ahora en el celu no se puede modificar el tamaño, en desktop si" + "Dale, hacelo lo mejor posible"
- L2 (2026-10-25) Playback with the four mockups sent; user: "Bien". Routes inline: one understood change per task, no writer reason.
