/**
 * Alerts on an indicator line or against another line (odd/tasks/chart-customization.md S7, migration 052).
 * The price against a value stays in price-worker.ts, on the quotes of each cycle; everything else is checked
 * here, on the candles of the alert's timeframe with the periods it stored, with the chart's own lines.
 *
 * A crossing is seen between two evaluations of the same alert, as a price alert sees it between the last
 * price and the new one: the values of the last candle (the live one) then and now. "Previous" is what this
 * process saw the last time it evaluated that alert with that same condition; with nothing seen yet (a new
 * alert, a re-armed one, an edited condition, a restarted worker) an evaluation only records.
 *
 * Relative imports only: the worker loads this with tsx, without the `@/` paths.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Candle, Timeframe } from './binance/types'
import type { IndicatorPoint } from './indicators'
import { DEFAULT_CONFIG, type IndicatorConfig } from './store/chart-store'
import { INDICATOR_SPECS } from './chart/indicator-specs'
import { indicatorOf, indicatorsOf, lineIdOf, type AlertCondition, type AlertOperator } from './chart/alert-condition'
import { conditionText, lineLabel, priceDecimals, timeframeLabel } from './chart/alerts'
import { loadCandles, type CandleLoad } from './alert-candles'
import { sendPushToUser, type PushPayload } from './push'
import { escapeHtml, sendTelegram } from './notifications'
import { bumpAlertsVersion } from './redis'
import { formatNumber } from './utils'

/** A price_alerts row with a condition that needs candles. */
export interface ConditionAlertRow {
  id: string
  user_id: string
  ticker: string
  source: string
  target: string
  operator: string
  value: number | string | null
  timeframe: Timeframe | null
  periods: Partial<IndicatorConfig> | null
}

/** Loads of a series that may pass (timeout, 5xx, rate limit) before its alerts go to "No se puede revisar":
 *  about ten minutes at the one-minute cycle. An unknown ticker, no candles or too few go at once. */
export const TRANSIENT_FAILURE_LIMIT = 10
/** Series (ticker and timeframe) loaded per run; with more, runs take turns. */
export const MAX_SERIES_PER_RUN = 20

type Way = 'up' | 'down'

/** Which way a difference (source − target) crossed zero between two evaluations: from below to on or above is up. */
export function crossingOf(before: number, now: number): Way | null {
  if (before < 0 && now >= 0) return 'up'
  if (before > 0 && now <= 0) return 'down'
  return null
}

/** Whether an operator fires on a crossing that way: 'crosses' fires on both. */
export const firesOn = (operator: string, way: Way) => operator === 'crosses' || operator === (way === 'up' ? 'crosses_above' : 'crosses_below')

/**
 * Moves an active alert to `patch.status`. True only for the evaluation whose update changed the row: a second
 * cycle or worker that saw the same thing changes nothing, so it sends nothing.
 */
export async function claimAlert(supabase: SupabaseClient, id: string, patch: { status: 'triggered'; triggered_at: string } | { status: 'unavailable' }): Promise<boolean> {
  const { data, error } = await supabase.from('price_alerts').update(patch).eq('id', id).eq('status', 'active').select('id')
  if (error) {
    console.error(`[Worker] evaluatePriceAlerts: update failed for ${id}`, error)
    return false
  }
  const claimed = (data?.length ?? 0) > 0
  // It is no longer active: the next cycle reads the active alerts again (price-worker.ts).
  if (claimed) await bumpAlertsVersion()
  return claimed
}

/** What the last evaluation of an alert saw; `sig` is the condition it computed. `start` is the window's first
 *  candle and `anchor` OBV on its last closed one, for an OBV condition (obvShift). */
interface Seen { sig: string; start: number; source: number; target: number; anchor: IndicatorPoint | null }

// ponytail: in memory, so a restart forgets it: the next evaluation only records, and a crossing during the
// restart is missed (never a false one). Keep it in Redis if that ever matters. A deleted alert's entry
// stays until the next restart (four numbers).
const seen = new Map<string, Seen>()
/** Transient failures in a row, per series. */
const failures = new Map<string, number>()
let turn = 0

/** Forgets what every alert saw and every failure count, as a restart does. */
export function forgetConditionState() {
  seen.clear()
  failures.clear()
  turn = 0
}

/** At most MAX_SERIES_PER_RUN series; with more, each run starts where the last one stopped. */
function takeTurn(keys: string[]): string[] {
  if (keys.length <= MAX_SERIES_PER_RUN) return keys
  console.warn(`[Worker] condition alerts: ${keys.length} series, ${MAX_SERIES_PER_RUN} checked this run`)
  const start = (turn++ * MAX_SERIES_PER_RUN) % keys.length
  return [...keys, ...keys].slice(start, start + MAX_SERIES_PER_RUN)
}

/** Checks each alert on its series' candles, loading each ticker and timeframe once. Never throws for one alert's data. */
export async function evaluateConditionAlerts(supabase: SupabaseClient, alerts: ConditionAlertRow[]): Promise<void> {
  const series = new Map<string, ConditionAlertRow[]>()
  for (const alert of alerts) {
    const key = `${alert.ticker} ${alert.timeframe}`
    series.set(key, [...(series.get(key) ?? []), alert])
  }
  const keys = takeTurn([...series.keys()].sort())
  const loads = await Promise.all(keys.map((key) => {
    const [{ ticker, timeframe }] = series.get(key)!
    return loadCandles(ticker, timeframe as Timeframe)
  }))

  for (const [i, key] of keys.entries()) {
    const load = loads[i]
    if (!load.ok && load.kind === 'transient') {
      const n = (failures.get(key) ?? 0) + 1
      console.warn(`[Worker] condition alert candles ${key}: ${load.error} (${n}/${TRANSIENT_FAILURE_LIMIT})`)
      if (n < TRANSIENT_FAILURE_LIMIT) {
        failures.set(key, n)
        continue
      }
    }
    failures.delete(key)
    for (const alert of series.get(key)!) await check(supabase, alert, load)
  }
}

const conditionOf = (a: ConditionAlertRow): AlertCondition => ({
  source: a.source,
  target: a.target,
  operator: a.operator as AlertOperator,
  value: a.value === null ? null : Number(a.value),
  timeframe: a.timeframe,
  periods: a.periods,
})

/** A line on the last candle, the live one; null while its periods need more candles than there are. */
function lineAt(line: string, candles: Candle[], periods: Partial<IndicatorConfig> | null): number | null {
  const last = candles.at(-1)!
  if (line === 'price') return last.close
  const data = INDICATOR_SPECS[indicatorOf(line)].lines(candles, { ...DEFAULT_CONFIG, ...periods }).find((l) => l.id === lineIdOf(line))?.data
  const point = data?.at(-1)
  return point && point.time === last.time && Number.isFinite(point.value) ? point.value : null
}

async function check(supabase: SupabaseClient, alert: ConditionAlertRow, load: CandleLoad) {
  const c = conditionOf(alert)
  const tf = timeframeLabel(alert.timeframe as Timeframe)
  if (!load.ok) {
    if (load.kind === 'unknown') return unavailable(supabase, alert, c, `No se encuentra ${alert.ticker}`, load.error)
    if (load.kind === 'empty') return unavailable(supabase, alert, c, `No hay velas de ${alert.ticker} en ${tf}`, load.error)
    return unavailable(supabase, alert, c, `No se pudieron traer las velas de ${alert.ticker} en ${tf} en ${TRANSIENT_FAILURE_LIMIT} intentos seguidos`, load.error)
  }

  const { candles } = load
  const source = lineAt(c.source, candles, c.periods)
  const target = c.target === 'value' ? c.value : lineAt(c.target, candles, c.periods)
  if (source === null || target === null) {
    const missing = lineLabel(source === null ? c.source : c.target, c.periods)
    return unavailable(supabase, alert, c, `Las ${candles.length} velas de ${tf} no alcanzan para calcular ${missing}`, 'too few candles')
  }

  const obv = indicatorsOf(c).includes('obv') ? INDICATOR_SPECS.obv.lines(candles, DEFAULT_CONFIG)[0].data : null
  const now: Seen = {
    sig: JSON.stringify([c.source, c.target, c.value, c.timeframe, c.periods]),
    start: candles[0].time,
    source,
    target,
    anchor: obv && obv.length > 1 ? obv.at(-2)! : null,
  }
  const before = seen.get(alert.id)
  seen.set(alert.id, now)
  if (!before || before.sig !== now.sig) return
  const shift = obvShift(before, now, obv)
  if (shift === null) return
  const based = (line: string, v: number) => (line === 'obv.obv' ? v + shift : v)
  const way = crossingOf(before.source - before.target, based(c.source, now.source) - based(c.target, now.target))
  if (way && firesOn(c.operator, way)) await fire(supabase, alert, c, way, now)
}

/**
 * OBV is 0 on a window's first candle, so when the window moved (Binance's last 1000 bars after a new one, Yahoo's
 * days back after midnight) every OBV value moved by the same amount. What to add to this window's OBV to put it
 * on the last one's base, through the last closed candle the last evaluation saw: a moved window alone is no
 * crossing, a real move through the value across it is. Null when this window no longer has that candle.
 */
function obvShift(before: Seen, now: Seen, obv: IndicatorPoint[] | null): number | null {
  if (!obv || before.start === now.start) return 0
  const same = before.anchor && obv.find((p) => p.time === before.anchor!.time)
  return same ? before.anchor!.value - same.value : null
}

const num = (n: number) => formatNumber(n, { decimals: priceDecimals(n) })

async function fire(supabase: SupabaseClient, alert: ConditionAlertRow, c: AlertCondition, way: Way, now: Seen) {
  // Fired here or elsewhere, it is no longer active: a re-armed alert starts over.
  seen.delete(alert.id)
  if (!(await claimAlert(supabase, alert.id, { status: 'triggered', triggered_at: new Date().toISOString() }))) return
  const words = conditionText({ ...c, operator: way === 'up' ? 'crosses_above' : 'crosses_below' })
  const values = [`${lineLabel(c.source, c.periods)} ${num(now.source)}`]
  if (c.target !== 'value') values.push(`${lineLabel(c.target, c.periods)} ${num(now.target)}`)
  const current = values.join(' · ')
  await notify(supabase, alert, { title: `Alerta: ${alert.ticker}`, body: `${words}. Ahora: ${current}` }, `🔔 Alerta disparada: ${alert.ticker}: ${words}\nAhora: ${current}`)
}

/** "No se puede revisar": once, on the change from active (S7). A re-armed alert is checked again. */
async function unavailable(supabase: SupabaseClient, alert: ConditionAlertRow, c: AlertCondition, reason: string, error: string) {
  seen.delete(alert.id)
  if (!(await claimAlert(supabase, alert.id, { status: 'unavailable' }))) return
  console.warn(`[Worker] alert ${alert.id} cannot be checked (${alert.ticker} ${alert.timeframe}): ${error}`)
  const words = conditionText(c)
  const why = `${reason}. No se vigila hasta que la reactives.`
  await notify(supabase, alert, { title: `No se puede revisar: ${alert.ticker}`, body: `${words}. ${why}` }, `⚠️ No se puede revisar la alerta de ${alert.ticker}: ${words}\n${why}`)
}

/** To the owner's devices and Telegram, as a fired price alert. A user who never turned notifications on has no devices. */
async function notify(supabase: SupabaseClient, alert: ConditionAlertRow, push: Pick<PushPayload, 'title' | 'body'>, telegram: string) {
  const sent = await sendPushToUser(supabase, alert.user_id, { ...push, url: `/trading?symbol=${encodeURIComponent(alert.ticker)}`, tag: `price-alert-${alert.id}` })
  if (!sent.ok && sent.error !== 'no devices') console.warn(`[Worker] push for alert ${alert.id}: ${sent.error}`)
  await sendTelegram(escapeHtml(telegram))
}
