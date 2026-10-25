# Chart customization: drawings, indicators and alerts like TradingView

Date: 2026-10-25. Status: every part approved by the user in conversation ("Bien segui", "Todo bien, segui", "Bien segui", "Perfecto"). Mockups: https://claude.ai/artifact/THwgp6hKAivqthcZgYw8zf (four phone screens: selected channel with its fill popover, channel settings sheet, choosing favorites, alert settings).

Branch: `feat/chart-customization`, cut from `fix/ticker-search` (8371bc8, the symbol search fix), which is cut from master 5460328. The user wants the search fix and this project merged together ("Quiero agregar más cosas antes de mergear").

## Why

The user uses Warren's Gráficos page every day, mostly as an installed iPhone PWA, and compares it with TradingView. Their words:

> "que se pueda modificar a los indicadores, alertas y dibujos, como en trading view, que se pueda cambiar sus configuraciones, colores, fondos, grosor, obvio que depende de cada indicador y tipo. También que como en trading view, se puedan fave se dibujos ya aparezcan la barra que se puede mover para todos lados con estos. Otra cosa es que, para poder mover un dibujo o alerta, primero se toca que presionar lo que se quiera mover, porque ahora cuando voy pasando el dedo y toco uno de estos, se mueve para todos lados"

> "en el canal paralelo, quería sacarle el fondo, cambiar el color. A alertas quiero cuando toco para configurar poder poner el color, cambiar el precio manualmente y el tipo de alerta"

> Alert condition: "tipo precio, alguna media móvil o para usar en algún indicador, después si es cruce ascendente, descendente o cualquiera de los dos, y el valor" … "Como en trading view"

Success: the user can restyle any drawing and indicator the way they would in TradingView, keep their favorite tools at hand in a bar they place where they want, set alerts on price or indicators, and swipe across the chart on the phone without grabbing drawings or alerts by accident.

## The four parts, in the agreed order

The user agreed to this order ("Si"). Each part is finished and tested (unit tests, the Chromium probe at phone and desktop widths) before the next one starts.

**Delivery: everything goes to master together, at the end** (user, asked "¿Subo cada parte a producción cuando esté lista, o todo junto al final?": "Todo junto al final"). The search fix (8371bc8) waits on the branch with the rest. The user tries the four parts on the iPhone only after the final merge deploys; until then the checks are the tests and the Chromium probe. The migration for account storage is applied (by the user, in the SQL Editor) right before that merge, not earlier: dev and prod share one Supabase, and nothing in production reads the new table until the code deploys. Reviewable slices for the pull request(s) are decided when the plan is written.

### 1. On touch, select before moving

Today a finger that lands on a drawing or an alert line and moves drags it, even when the user meant to pan the chart. The touch hit areas were enlarged for phones (`scripts/patch-drawing-lib.mjs`; `TOUCH_HIT_PX` in `TradingChart.tsx`), which makes accidental grabs more likely.

Approved behavior, for touch pointers only:

- Dragging over a drawing or alert that is not selected pans the chart as if it were not there.
- A tap (no drag) on a drawing or alert selects it: the drawing shows its points and its bar (`DrawingActions`), as today.
- Once selected, dragging its body moves it; dragging one of its points reshapes it. An alert, once selected, drags to a new price.
- A tap on an empty part of the chart, or "Listo", deselects.

My calls, told to the user and not objected to:

- The mouse is unchanged: press and drag still moves a drawing or alert directly, like TradingView on a computer.
- A locked drawing can be selected (to change its settings) but not moved.

My call after the builder check (the user checks it while reading this document):

- A selected alert behaves like a selected drawing: the line is highlighted and a small bar appears with ⚙ (opens the alert sheet of part 4), Borrar and Listo. A tap selects; it does not open the sheet. With a mouse, a click without dragging selects the same way.

### 2. Drawing settings and the favorites bar

The selected-drawing bar today offers one color (it sets line and text together), width, line style, lock, delete, edit text and "Listo".

Approved (mockup screens 1–3):

- **Fill button** in the bar, only on drawings that have a fill (parallel channel, rectangle, Fibonacci tools, price/date ranges, long/short position): fill on/off, fill color, transparency.
- **Settings button (⚙)** in the bar opens every option that drawing kind has. On a phone it is a sheet from the bottom; on a computer, a dialog. For a parallel channel: line (color, width, style), fill (on/off, color, transparency), middle line, extend left, extend right. Each kind shows its own options; Fibonacci adds its levels, each with its own color and on/off. Text-bearing kinds show their text options.
- **A new drawing comes out with the style last chosen for that tool** (user: "Salga igual"). "Volver al de fábrica" in the settings resets that tool's remembered style to the library's.
- **Favorites**: a star next to each tool in the Dibujar list. Starred tools appear in a floating bar over the chart (vertical, a grip on top to drag it anywhere). Tapping a tool in the bar arms it, like picking it from the list. A switch at the top of the Dibujar list hides or shows the bar.
- **Favorites and remembered styles are the same on the phone and the computer** (user: "Si"). Drawings already live in the account (`chart_drawings`); this needs account storage too.

My calls:

- The favorites bar's position is per device (screens differ).
- On a computer, the same floating bar and the same settings content.

The drawing library (`lightweight-charts-drawing` 0.6.2) already renders TradingView's options: `DrawingStyle` has `fillBackground`, `backgroundColor`, `transparency`, `extendLeft`/`extendRight`, `levels` (Fibonacci), text and font fields, stats flags, `stopColor`/`targetColor`. This part is UI and persistence over options the library already draws.

### 3. Indicator settings

Today `IndicatorSettingsDialog` edits only numbers (periods, std dev, etc.); colors come from `INDICATOR_COLORS` in `src/lib/store/chart-store.ts` and `src/lib/chart/indicator-specs.ts`.

Approved: the same settings sheet, with:

- **Values**: today's numbers.
- **Style**: each line of the indicator separately: color, width, show/hide. Per indicator:
  - EMA 20/50/200: its line.
  - Bollinger: upper, middle, lower, and the fill between the bands (on/off, color, transparency).
  - RSI: its line, its levels (70 and 30 editable, each with a color) and the fill between the levels.
  - MACD: MACD line, signal, histogram with one color for rising bars and one for falling.
  - Volume: rising and falling colors.
  - OBV, Stochastic, ADX: their lines, same pattern.
- "Volver al de fábrica".

My calls, told to the user:

- Indicator settings are also the same on the phone and the computer (today the zustand store `tv-gratis-chart-state` keeps them per device).
- The three EMAs stay as they are; adding SMA or more than three moving averages is out of scope.

My calls after the builder check:

- Nothing moves to the account until the user changes it. The account starts empty and each device keeps its current values. When the user saves an indicator's settings (its values or its style), that indicator's settings go to the account and apply on every device from then on. This keeps the anti-goal: a user who never opens the settings sees each chart exactly as before.
- Which indicators are turned on, and which are hidden, stays per device: the phone keeps the panes it has room for.

### 4. Alert settings and conditions like TradingView

Today a chart alert is placed by tapping Alerta and then the chart; its operator (`crosses_above`/`crosses_below`) is chosen by whether the line sits above or below the last price. Tapping an alert line shows no settings. The worker (`evaluatePriceAlerts` in `src/lib/price-worker.ts`) checks only price crosses, once per cycle. The table `price_alerts` (migration 026) already allows `type IN ('price','rsi','ema20','ema50','macd_signal')` but nothing evaluates those.

Approved (mockup screen 4): tapping an alert, or creating one, opens a sheet with:

- **When**: the price, or any line of an indicator (EMA 20/50/200, RSI, MACD and its signal, Bollinger bands, …).
- **Crossing**: up, down, or either.
- **Against**: a value typed by hand (32,50; or 70 for RSI), or another line ("price crosses EMA 50", "EMA 20 crosses EMA 50").
- **Color** of the alert.
- A sentence that restates the condition before saving ("Te avisa una vez cuando el precio de FXI cruce la EMA 50, para arriba o para abajo.").
- Delete.

My calls, told to the user:

- An indicator alert uses the candles of the chart's timeframe when it was created (1D, 1h, …), and the alert shows that timeframe.
- It fires once, as today, through push and Telegram; it can be re-armed afterwards (the existing rearm).
- The quick way stays: Alerta, then a tap on the chart, creates a price alert at once; tapping it opens the sheet.
- Only alerts against a fixed value draw a line on the chart (a price alert on the price pane; "RSI crosses 70" may draw in the RSI pane when RSI is shown). "Price crosses EMA 50" has no line of its own; it appears in the alerts list.
- The server must evaluate indicator conditions: fetch candles for the alert's ticker and timeframe and compute the indicator on each check. This is the heaviest part of the project.

My calls after the builder check:

- **Where alerts are listed on the chart page**: the Alerta button opens a small menu instead of arming at once: "Tocar el precio en el gráfico" (today's quick creation), "Nueva alerta…" (the sheet, prefilled with the last price), and the list of this ticker's alerts, each one opening its sheet. This is how an alert with no line ("precio cruza EMA 50") is seen, edited and deleted on the chart page, and how an alert on an indicator is created directly.
- The existing list in Estrategias → Alertas (`PriceAlertsTab`) keeps working and describes the new conditions in words ("Precio cruza EMA 50 (1D) · cualquiera"); it does not open the sheet.
- The sheet takes the indicator's periods from the chart's current settings when the alert is created, and the alert keeps them (TradingView does the same).
- **A broken indicator alert**: when the server cannot compute an alert's condition (no candles, unknown ticker), the alert moves to a new status shown as "No se puede revisar" in both lists and in its sheet, and the user gets one push and Telegram message at that moment (only on the change to that status, never repeated).

## Non-goals

- New drawing tools, new indicators, SMA, more than three moving averages.
- TradingView's alert frequencies beyond "once" (once per bar, every time), expirations, webhooks, custom messages.
- Visibility-per-timeframe for drawings, drawing templates by name, coordinates editing for drawings.
- Changing how drawings are drawn (the library renders them).

## Anti-goals (would make it a failure even if it works)

- The chart on the phone losing the space won in PR #31: the favorites bar must not take a permanent strip; it floats and can be hidden.
- Mouse users losing direct drag.
- An alert that silently never fires: an indicator alert whose candles or indicator cannot be computed must not look armed and healthy.
- Existing drawings, alerts or indicator settings changing appearance or behavior after the upgrade (a user who never opens the new settings sees the chart exactly as before).

## Constraints

- Next.js 14 App Router, UI copy in Spanish (Rioplatense voseo), code and docs in English.
- `lightweight-charts` 5.2.0 and `lightweight-charts-drawing` 0.6.2, patched at install by `scripts/patch-drawing-lib.mjs` (the patch fails the install if the library version changes).
- Phone layout from PR #31 (top bar, bottom tool bar, portaled drawing controls, `max-[819px]:isolate` on the chart box): keep it.
- Responsive is a requirement: no horizontal scroll from 320 to 1920 px.
- Account storage means a new migration (last applied: 050). The user applies migrations by pasting them in the Supabase SQL Editor; I verify with SELECT. No writes to production data without the user's explicit OK. The only account touched is `54745d6e-3c1f-49b3-b46d-78d4016e8c20`.
- Production: Oracle VM, Docker image built by CI on push to master; the worker runs in the same deployment. Every merge to master deploys.
- Tests: vitest + jsdom; UI checked in a Chromium probe at phone and desktop widths against stubbed APIs, never against production data.

## Left to the builder

- Storage shape for favorites, remembered drawing styles and indicator styles (one preferences row per user, or separate tables), and how the client syncs and falls back offline.
- How to intercept touch on the drawing library to get select-before-move (an option, a wrapper, or a patch in `scripts/patch-drawing-lib.mjs`).
- The exact option list per drawing kind, following TradingView's settings for that kind and what `DrawingStyle` supports.
- How the worker fetches candles and computes indicators for alerts (reuse `src/lib/indicators`, the market-data provider and Binance for crypto), its cadence, and limits.
- The alert data model change (new columns or a JSON condition) and keeping existing price alerts working unchanged.
- Splitting the delivery into PRs.
