# Chart and drawings on the phone

Objective: the Gráficos section (`/trading`) works well with a finger on the iPhone PWA: drawing, selecting, editing, moving and deleting drawings, panning and zooming, and price alerts from the chart.
Branch `feat/chart-mobile` from master 37525ad (the crypto alerts fix is separate, `fix/crypto-alerts` a7767c2). Delivery: stacked to master, as the earlier UX projects. Tests: vitest (`npx vitest run`), `npx tsc --noEmit`, `npm run lint`, plus touch probes in Chromium (CDP touch events) at 320-430px.

## Specs

- S1 "es muy difícil usar el gráfico en el [celular]" — gestures: moving a drawing, its handles, the brush and an alert line follow the finger to the end of the gesture; panning the chart never moves a drawing; a pinch zooms the chart, not the page. Verified cause (L3): the browser takes the touch for itself (`touch-action` auto) and cancels the pointer mid-gesture.
- S2 Drawing with a finger: with a tool armed, dragging draws from where the finger lands to where it lifts, and the drawing is visible while dragging; tapping point after point keeps working; a one-point tool places on a tap; no gesture leaves a hidden half-placed point that the next tap turns into a stray drawing (L3).
- S3 The selected drawing on the phone: a tap selects it and shows its actions: color, thickness, line style, edit text (text tools), lock/unlock, delete, and "Listo" to deselect. Today a drawing can only be deleted with the Delete key and text only edited with a double click (L3). The text editor stays inside the screen at 320-430px.
- S4 Finger-sized targets: with touch, a line or shape is selectable within a finger's reach of it and its handles are bigger to grab; the mouse keeps today's precision. Decided by me: body tolerance 14px and handle radius 12px (hit 26px) for touch, against 6px and 6px (hit 12px) today.
- S5 The tools have names on the phone: one "Dibujar" control opens the tools with their names, plus magnet, hide drawings and delete all; the armed tool shows what to do ("Tocá o arrastrá…") and a "Cancelar" button, because a phone has no Esc.
- S6 The price pane keeps most of the height on the phone even with oscillators open (today 8 indicators leave it about 270px of 536, L3).
- S7 Price alerts from the chart: the price keeps the symbol's precision (today it is rounded to 2 decimals, which breaks cheap coins); its buttons are finger-sized; no "Esc" wording on touch.
- S8 A drawing changed just before leaving the app is saved (today the save waits 600ms and is lost if the PWA goes to the background).
- S9 "Porfavor fíjate cómo mejorar todos los dibujos y los gráficos, es fundamental que ande lo mejor posible": every tool in the toolbar is checked with a finger at 390px (place, select, move, edit, delete); the desktop (mouse) behavior stays as it is.

## Tasks

| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 `touch-action: none` on the chart; regression test | S1 | inline | done: RED→GREEN (jsdom), touch probe: 100px move, no pointercancel, pan leaves the line | (this commit) |
| T2 Touch hit sizes: install-time patch of lightweight-charts-drawing 0.6.2 (script + Dockerfile + CI) | S4 | inline | done: behavior test RED→GREEN (finger 12px off selects, mouse unchanged); script tests (written after) cover version and missing-line failures; Risk item 5 | (this commit) |
| T3 Touch drawing: drag places the second point with a live preview | S2 | inline | pending | |
| T4 Selected-drawing bar (color, thickness, style, text, lock, delete) and text editor inside the screen | S3 | inline | pending | |
| T5 Tool picker with names, armed-tool hint and Cancelar | S5 | inline | pending | |
| T6 Price pane height on phones; alert precision, buttons and wording | S6, S7 | inline | pending | |
| T7 Save drawings when the app goes to the background | S8 | inline | pending | |
| T8 Every tool with a finger at 320-430px, desktop unchanged, suite, independent verifier (Risk item 5: install patch, Dockerfile), native review | S9, all | inline + verifier | pending | |

Route evidence: every unit touches `TradingChart.tsx` or depends on T1-T3, so they are not independent; each is about 100 lines or less; inline, one after another.

## Log

- L1 (2026-10-24, user, after the crypto alerts diagnosis): "Arréglalo y de pasa es muy difícil usar el gráfico en el usar. Porfavor fíjate cómo mejorar todos los dibujos y los gráficos, es fundamental que ande lo mejor posible"
- L2: map (read-only explorer). /trading: Header (symbol, timeframes, indicators), TradingChart (lightweight-charts 5.2 with defaults, DrawingManager of lightweight-charts-drawing 0.6.2), DrawingTools (21 icon-only 44px buttons, horizontal scroll below 820px), alerts as price lines. The drawing lib handles only pointer events (no `pointerType`, no `pointercancel`), places points on pointerdown, deletes only with Delete/Backspace, edits text only on dblclick; hit tolerances are module constants (`et = 6, L = 6`, handle hit `ot = et + L`). Drawings persist per user and ticker through `PUT /api/chart-drawings` (debounced 600ms). No test covers TradingChart or touch.
- L3: touch probes (Chromium, iPhone viewport 390x760, CDP touch events, real page through a throwaway route with stubbed `/api/*`). Tap-tap draws a trend line. Dragging to draw makes the browser cancel the pointer: nothing is drawn, the first point stays pending and the next tap creates a line from the drag start. Moving a selected line by 100px moved it 17px (pointercancel), and the next one-finger pan moved the line instead of the chart. With `.tv-lightweight-charts { touch-action: none }` injected: the line moves the full 100px, no pointercancel, and the pan scrolls the chart while the line stays on its data. With 8 indicators the price pane is 274px of 536 at 390px.
