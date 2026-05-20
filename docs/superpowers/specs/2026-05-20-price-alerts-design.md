# Design: TradingView-style Price Alerts

**Date:** 2026-05-20  
**Branch:** feat/price-alerts (new, stacked on master)  
**Status:** Approved

---

## 1. Context

Warren today has two notification systems:
- **Sprint-6 signal alerts** — fire when a BullMQ signals-worker job detects a setup buy/sell signal. Tied to strategies/setups, configured per setup. Backend complete, UI in strategies page.
- **Nothing else** — users have no way to set a simple "alert me when AAPL crosses $195" threshold.

This design adds TradingView-style standalone price/indicator alerts: user right-clicks on the chart, picks a price, and gets a Telegram message when the price crosses that level. One-shot, no strategy required.

---

## 2. Scope

**In scope:**
- New `price_alerts` table (standalone, not tied to strategies)
- Chart right-click context menu → floating creation widget
- Horizontal dashed price line drawn on the chart for each active alert
- BullMQ evaluation in the price-worker (after each price fetch)
- Telegram notification on trigger (reuses `src/lib/notifications.ts`)
- One-shot: alert auto-marks as `triggered` and does not re-fire
- Strategies page Alertas tab: show `price_alerts` (replaces sprint-6 setup-alerts UI)

**Out of scope:**
- Email notifications (Telegram only)
- Indicator alerts (RSI, EMA, MACD) — price alerts only in this sprint; indicator type column is future-proofed in the DB but evaluation is price-only
- Re-arming / snoozing triggered alerts
- Alert editing (delete and re-create)
- Mobile chart right-click (mobile gets the create flow deferred)

---

## 3. Data Model

### 3.1 New table: `price_alerts`

```sql
CREATE TABLE price_alerts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker        TEXT        NOT NULL,
  type          TEXT        NOT NULL DEFAULT 'price'
                            CHECK (type IN ('price', 'rsi', 'ema20', 'ema50', 'macd_signal')),
  operator      TEXT        NOT NULL
                            CHECK (operator IN ('crosses_above', 'crosses_below')),
  value         NUMERIC     NOT NULL,
  name          TEXT        NOT NULL,   -- e.g. "AAPL-price-195.40-above"
  channel       TEXT        NOT NULL DEFAULT 'telegram',
  status        TEXT        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'triggered')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  triggered_at  TIMESTAMPTZ
);

-- RLS
ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users own their alerts"
  ON price_alerts FOR ALL USING (auth.uid() = user_id);
```

### 3.2 Name format (auto-generated client-side)

| type | operator | value | name |
|------|----------|-------|------|
| price | crosses_above | 195.40 | `AAPL-price-195.40-above` |
| price | crosses_below | 185.00 | `AAPL-price-185.00-below` |
| rsi (future) | crosses_above | 70 | `AAPL-rsi-70-above` |

---

## 4. API Routes

All routes use `requireUser()` + `isAuthFailure()` from `@/lib/api-auth`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/price-alerts` | List active + triggered alerts for the user |
| `POST` | `/api/price-alerts` | Create a new alert |
| `DELETE` | `/api/price-alerts/[id]` | Delete an alert |

No PATCH needed — alerts are one-shot and immutable after creation (delete to remove).

### POST body
```ts
{
  ticker: string       // "AAPL"
  type: string         // "price"
  operator: string     // "crosses_above" | "crosses_below"
  value: number        // 195.40
  name: string         // "AAPL-price-195.40-above"
}
```

---

## 5. Chart Integration

### 5.1 Right-click context menu

**Component:** `src/components/trading/chart/ChartContextMenu.tsx` (new)  
**Parent:** `PriceChart.tsx` — listens to `contextmenu` event on the chart container div.

```
onContextMenu(e) {
  e.preventDefault()
  const price = chart.coordinateToPrice(e.offsetY)  // from lightweight-charts
  openContextMenu({ x: e.clientX, y: e.clientY, price })
}
```

Menu items (TailwindCSS glass card, positioned via `position: fixed`):
```
🔔  Nueva alerta aquí   ← opens AlertCreationWidget pre-filled with price
✏️  Línea horizontal    ← draws a free annotation line (future)
```

Menu closes on outside click or Escape.

### 5.2 AlertCreationWidget

**Component:** `src/components/trading/chart/AlertCreationWidget.tsx` (new)  
Floating panel anchored near the right-click position (repositioned if too close to viewport edge).

Fields:
- **Ticker**: read-only, pre-filled from current chart symbol
- **Tipo**: `price` (only option for now, disabled select)
- **Condición**: `crosses_above` / `crosses_below` (segmented control)
- **Valor**: number input, pre-filled with the clicked price (rounded to 2 decimals)
- **Preview name**: `AAPL-price-195.40-above` shown as monospace label
- **Crear alerta** button → POST `/api/price-alerts` → shows toast → closes widget → draws line

### 5.3 Alert price lines on chart

**Where:** `PriceChart.tsx`, after fetching active alerts for the current ticker.  
**API call:** `GET /api/price-alerts?ticker=AAPL` on symbol change.  
**Drawing:**

```ts
const priceLine = series.createPriceLine({
  price: alert.value,
  color: '#f59e0b',         // amber
  lineWidth: 1,
  lineStyle: LineStyle.Dashed,
  axisLabelVisible: true,
  title: alert.name,
})
```

Lines are redrawn when the user switches symbols. Triggered alerts are shown at 40% opacity (or not shown — decided: hide triggered alerts' lines to keep the chart clean).

---

## 6. Alert Evaluation (Worker)

**File:** `src/lib/price-worker.ts` — extend the existing price-update job.

After each batch of price updates for a set of tickers, call `evaluatePriceAlerts(tickers, prices)`:

```ts
async function evaluatePriceAlerts(
  prices: Record<string, number>  // { AAPL: 197.32, ... }
): Promise<void> {
  // 1. Fetch all active price alerts for the updated tickers
  const alerts = await supabase
    .from('price_alerts')
    .select('*')
    .eq('status', 'active')
    .eq('type', 'price')
    .in('ticker', Object.keys(prices))

  for (const alert of alerts.data ?? []) {
    const currentPrice = prices[alert.ticker]
    const fired =
      (alert.operator === 'crosses_above' && currentPrice >= alert.value) ||
      (alert.operator === 'crosses_below' && currentPrice <= alert.value)

    if (fired) {
      // 2. Mark as triggered (one-shot)
      await supabase
        .from('price_alerts')
        .update({ status: 'triggered', triggered_at: new Date().toISOString() })
        .eq('id', alert.id)

      // 3. Send Telegram notification
      const direction = alert.operator === 'crosses_above' ? '↑' : '↓'
      const msg = `🔔 Alerta disparada: ${alert.ticker} ${direction} ${alert.value}\nPrecio actual: ${currentPrice}`
      await sendTelegram(msg)
    }
  }
}
```

**Important:**
- Uses `createServiceClient()` — worker runs outside RLS context
- `sendTelegram` is already implemented in `src/lib/notifications.ts`
- Worker uses relative imports (no `@/` aliases) — import path: `../../lib/notifications`
- Evaluation runs after the Yahoo Finance price batch, not in a separate schedule

---

## 7. Strategies Page — Alertas Tab

**File:** `src/app/strategies/[id]/page.tsx` — existing tab strip already has `'setups' | 'alerts'` state (from sprint-6).

The Alertas tab content (`AlertsTab.tsx`) is replaced with a new component that shows `price_alerts` (not the sprint-6 setup-based alerts):

**Component:** `src/components/strategies/PriceAlertsTab.tsx` (new — replaces current AlertsTab)

> Note: The current `AlertsTab.tsx` is tied to setup-based alerts from the sprint-6 `alerts` table. The new component reads from `price_alerts` and shows ALL user alerts (not filtered by strategy), matching the user's requirement to see "todas las alertas que hay en el sistema".

### Table columns

| Column | Content |
|--------|---------|
| Ticker | amber chip: `AAPL` |
| Tipo | white/06 chip: `price` |
| Condición | monospace: `cruza 195.40 ↑` |
| Estado | `tag-positive` "activa" / `tag-neutral` "disparada" |
| × | delete button, hover → rose |

Triggered rows rendered at 40% opacity.

### Fetch

`GET /api/price-alerts` — no strategy filter (shows all user alerts).  
Called on tab mount, no polling.

---

## 8. Files Touched

| File | Action |
|------|--------|
| `supabase/migrations/026_price_alerts.sql` | New — creates `price_alerts` table + RLS |
| `src/app/api/price-alerts/route.ts` | New — GET + POST |
| `src/app/api/price-alerts/[id]/route.ts` | New — DELETE |
| `src/components/trading/chart/ChartContextMenu.tsx` | New |
| `src/components/trading/chart/AlertCreationWidget.tsx` | New |
| `src/components/trading/chart/PriceChart.tsx` | Modified — context menu + alert lines |
| `src/components/strategies/PriceAlertsTab.tsx` | New — replaces AlertsTab in strategies page |
| `src/app/strategies/[id]/page.tsx` | Modified — swap AlertsTab → PriceAlertsTab |
| `src/lib/price-worker.ts` | Modified — add evaluatePriceAlerts() call |

Files **not** touched: `src/lib/notifications.ts` (reused as-is).  
Files **deleted**: `src/components/strategies/AlertsTab.tsx`, `src/components/strategies/AlertRow.tsx`, `src/components/strategies/AlertHistoryModal.tsx` — replaced by PriceAlertsTab.

---

## 9. Constraints and Gotchas

- **Worker uses relative imports**: `src/lib/price-worker.ts` can't use `@/` aliases — import notifications as `'./notifications'` (same `src/lib/` directory).
- **`createServiceClient()` in worker**: alerts evaluation needs service role to bypass RLS.
- **Lightweight-charts `createPriceLine`**: tied to a series object — must target the main candlestick/line series, not the chart object.
- **Context menu positioning**: `position: fixed` with `left: e.clientX, top: e.clientY` — clamp to `window.innerWidth - menuWidth` and `window.innerHeight - menuHeight` to avoid overflow.
- **No re-evaluation guard needed**: `status = 'triggered'` filter prevents double-firing.
- **Migration number**: next available is `026` (025 is `alert_history.sql` from sprint-6).
