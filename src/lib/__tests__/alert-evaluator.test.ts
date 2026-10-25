import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Candle } from '../binance/types'
import { INDICATOR_SPECS } from '../chart/indicator-specs'
import { indicatorOf, lineIdOf } from '../chart/alert-condition'
import { priceDecimals } from '../chart/alerts'
import { DEFAULT_CONFIG, type IndicatorConfig } from '../store/chart-store'
import { formatNumber } from '../utils'

// odd/tasks/chart-customization.md S7: the worker evaluates every condition T6 stores on the candles of
// the alert's timeframe, between one evaluation and the next, fires once, and says once when it cannot.

const mockSendTelegram = vi.fn()
vi.mock('../notifications', async () => ({
  ...(await vi.importActual<typeof import('../notifications')>('../notifications')),
  sendTelegram: (...a: unknown[]) => mockSendTelegram(...a),
}))
const mockSendPush = vi.fn()
vi.mock('../push', async () => ({
  ...(await vi.importActual<typeof import('../push')>('../push')),
  sendPushToUser: (...a: unknown[]) => mockSendPush(...a),
}))
const mockFetchKlines = vi.fn()
vi.mock('../binance/rest', () => ({ fetchServerKlines: (...a: unknown[]) => mockFetchKlines(...a) }))
const mockGetCandles = vi.fn()
vi.mock('../market-data', async () => ({
  getMarketDataProvider: () => ({ getCandles: (...a: unknown[]) => mockGetCandles(...a) }),
  MarketDataError: (await import('../market-data/types')).MarketDataError,
}))

const { evaluateConditionAlerts, forgetConditionState, TRANSIENT_FAILURE_LIMIT, MAX_SERIES_PER_RUN } = await import('../alert-evaluator')
type Alert = Parameters<typeof evaluateConditionAlerts>[1][number]

// ── price_alerts as the worker sees it ───────────────────────────────────────
// An update guarded by `.eq('status', 'active')` changes a row only while it is active, as Postgres does.
const rows = new Map<string, Record<string, unknown>>()
let updates: { id: string; patch: Record<string, unknown> }[] = []
const db = {
  from: (table: string) => ({
    update: (patch: Record<string, unknown>) => ({
      eq: (_id: string, id: string) => ({
        eq: (column: string, value: unknown) => ({
          select: async () => {
            const row = rows.get(id)
            if (table !== 'price_alerts' || !row || row[column] !== value) return { data: [], error: null }
            Object.assign(row, patch)
            updates.push({ id, patch })
            return { data: [{ id }], error: null }
          },
        }),
      }),
    }),
  }),
} as unknown as SupabaseClient

/** An active alert in the table: by default "price crosses EMA 50 (1h), either way" on BTCUSDT. */
function alert(id: string, fields: Partial<Alert> = {}): Alert {
  const row = { id, user_id: 'owner-1', ticker: 'BTCUSDT', source: 'price', target: 'ema50.ema50', operator: 'crosses', value: null, timeframe: '1h', periods: { ema50: 50 }, ...fields } as Alert
  rows.set(id, { ...row, status: 'active' })
  return row
}

/** One worker cycle: every series answers with these candles. */
function cycle(alerts: Alert[], candles: Candle[]) {
  mockFetchKlines.mockImplementation(async () => candles)
  return evaluateConditionAlerts(db, alerts)
}

// ── Fixtures: the expected values come from the chart's own indicator lines ──
const bars = (closes: number[]): Candle[] => closes.map((close, i) => ({ time: 1_760_000_000 + i * 3600, open: close, high: close + 1, low: close - 1, close, volume: 1000 + i }))
const ramp = (from: number, to: number, n: number) => Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1))
const FALL_RISE = bars([...ramp(200, 100, 100), ...ramp(101, 220, 60)])
const RISE_FALL = bars([...ramp(100, 200, 100), ...ramp(199, 80, 60)])

function valueOf(candles: Candle[], line: string, periods: Partial<IndicatorConfig> = {}): number {
  if (line === 'price') return candles.at(-1)!.close
  const data = INDICATOR_SPECS[indicatorOf(line)].lines(candles, { ...DEFAULT_CONFIG, ...periods }).find((l) => l.id === lineIdOf(line))!.data
  return data.at(-1)?.value ?? NaN
}
const minus = (source: string, target: string, periods: Partial<IndicatorConfig> = {}) => (c: Candle[]) => valueOf(c, source, periods) - valueOf(c, target, periods)

/** The bar count at which `diff` first goes from below 0 to 0 or above ('up'), or the mirror. */
function crossAt(series: Candle[], way: 'up' | 'down', diff: (c: Candle[]) => number): number {
  for (let n = 2; n <= series.length; n++) {
    const before = diff(series.slice(0, n - 1))
    const now = diff(series.slice(0, n))
    if (way === 'up' ? before < 0 && now >= 0 : before > 0 && now <= 0) return n
  }
  throw new Error('the fixture never crosses')
}

const num = (n: number) => formatNumber(n, { decimals: priceDecimals(n) })
const firedIds = () => updates.filter((u) => u.patch.status === 'triggered').map((u) => u.id)
const nothingSent = () => {
  expect(mockSendPush).not.toHaveBeenCalled()
  expect(mockSendTelegram).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSendTelegram.mockResolvedValue({ ok: true })
  mockSendPush.mockResolvedValue({ ok: true, sent: 1 })
  rows.clear()
  updates = []
  forgetConditionState()
})

describe('the price crossing the EMA 50', () => {
  const priceVsEma = minus('price', 'ema50.ema50')

  it('going up fires "up" and "either", once each, with the condition in words', async () => {
    const n = crossAt(FALL_RISE, 'up', priceVsEma)
    const alerts = [alert('up', { operator: 'crosses_above' }), alert('down', { operator: 'crosses_below' }), alert('either', { operator: 'crosses' })]

    await cycle(alerts, FALL_RISE.slice(0, n - 1))
    expect(updates).toEqual([])
    await cycle(alerts, FALL_RISE.slice(0, n))

    expect(firedIds()).toEqual(['up', 'either'])
    expect(updates[0].patch).toEqual({ status: 'triggered', triggered_at: expect.any(String) })
    const now = FALL_RISE.slice(0, n)
    const words = 'Precio cruza EMA 50 (1h) · para arriba'
    const values = `Precio ${num(valueOf(now, 'price'))} · EMA 50 ${num(valueOf(now, 'ema50.ema50'))}`
    expect(mockSendPush).toHaveBeenCalledTimes(2)
    expect(mockSendPush).toHaveBeenCalledWith(db, 'owner-1', { title: 'Alerta: BTCUSDT', body: `${words}. Ahora: ${values}`, url: '/trading?symbol=BTCUSDT', tag: 'price-alert-up' })
    expect(mockSendTelegram).toHaveBeenCalledTimes(2)
    expect(mockSendTelegram).toHaveBeenCalledWith(`🔔 Alerta disparada: BTCUSDT: ${words}\nAhora: ${values}`)
    // One series, one fetch per cycle for the three alerts.
    expect(mockFetchKlines.mock.calls).toEqual([['BTCUSDT', '1h', 1000], ['BTCUSDT', '1h', 1000]])

    // The price stays above: nothing fires again.
    await cycle(alerts, FALL_RISE.slice(0, n + 1))
    expect(mockSendPush).toHaveBeenCalledTimes(2)
  })

  it('going down fires "down" and "either", and says it went down', async () => {
    const n = crossAt(RISE_FALL, 'down', priceVsEma)
    const alerts = [alert('up', { operator: 'crosses_above' }), alert('down', { operator: 'crosses_below' }), alert('either', { operator: 'crosses' })]

    await cycle(alerts, RISE_FALL.slice(0, n - 1))
    await cycle(alerts, RISE_FALL.slice(0, n))

    expect(firedIds()).toEqual(['down', 'either'])
    const now = RISE_FALL.slice(0, n)
    expect(mockSendTelegram).toHaveBeenCalledWith(
      `🔔 Alerta disparada: BTCUSDT: Precio cruza EMA 50 (1h) · para abajo\nAhora: Precio ${num(valueOf(now, 'price'))} · EMA 50 ${num(valueOf(now, 'ema50.ema50'))}`,
    )
  })
})

describe('indicator lines', () => {
  it('the RSI 14 crossing 70 up', async () => {
    const series = bars([...Array.from({ length: 40 }, (_, i) => 100 + (i % 2)), ...ramp(101, 131, 31)])
    const n = crossAt(series, 'up', (c) => valueOf(c, 'rsi.rsi') - 70)
    const alerts = [alert('rsi', { source: 'rsi.rsi', target: 'value', value: 70, operator: 'crosses_above', periods: { rsi: 14 } })]

    await cycle(alerts, series.slice(0, n - 1))
    await cycle(alerts, series.slice(0, n))

    expect(firedIds()).toEqual(['rsi'])
    const rsi = num(valueOf(series.slice(0, n), 'rsi.rsi'))
    expect(mockSendPush).toHaveBeenCalledWith(db, 'owner-1', expect.objectContaining({ body: `RSI 14 cruza 70 (1h) · para arriba. Ahora: RSI 14 ${rsi}` }))
    expect(mockSendTelegram).toHaveBeenCalledWith(`🔔 Alerta disparada: BTCUSDT: RSI 14 cruza 70 (1h) · para arriba\nAhora: RSI 14 ${rsi}`)
  })

  it('the EMA 20 crossing the EMA 50', async () => {
    const periods = { ema20: 20, ema50: 50 }
    const n = crossAt(FALL_RISE, 'up', minus('ema20.ema20', 'ema50.ema50'))
    const alerts = [alert('ema', { source: 'ema20.ema20', target: 'ema50.ema50', operator: 'crosses_above', periods })]

    await cycle(alerts, FALL_RISE.slice(0, n - 1))
    await cycle(alerts, FALL_RISE.slice(0, n))

    expect(firedIds()).toEqual(['ema'])
    const now = FALL_RISE.slice(0, n)
    expect(mockSendTelegram).toHaveBeenCalledWith(
      `🔔 Alerta disparada: BTCUSDT: EMA 20 cruza EMA 50 (1h) · para arriba\nAhora: EMA 20 ${num(valueOf(now, 'ema20.ema20'))} · EMA 50 ${num(valueOf(now, 'ema50.ema50'))}`,
    )
  })

  it('are computed with the periods the alert stored, not the defaults', async () => {
    const n = crossAt(FALL_RISE, 'up', minus('price', 'ema50.ema50', { ema50: 10 }))
    const slow = minus('price', 'ema50.ema50', { ema50: 50 })
    expect(Math.sign(slow(FALL_RISE.slice(0, n - 1)))).toBe(Math.sign(slow(FALL_RISE.slice(0, n)))) // the EMA 50 does not cross there
    const alerts = [alert('fast', { operator: 'crosses_above', periods: { ema50: 10 } }), alert('slow', { operator: 'crosses_above', periods: { ema50: 50 } })]

    await cycle(alerts, FALL_RISE.slice(0, n - 1))
    await cycle(alerts, FALL_RISE.slice(0, n))

    expect(firedIds()).toEqual(['fast'])
    expect(mockSendTelegram.mock.calls[0][0]).toMatch(/^🔔 Alerta disparada: BTCUSDT: Precio cruza EMA 10 \(1h\) · para arriba\nAhora: Precio [\d.,]+ · EMA 10 [\d.,]+$/)
  })

  // OBV is 0 on a window's first candle, so when Binance's last 1000 bars move by one every OBV value moves by
  // the dropped bar. The worker puts the new window on the previous one's base through a closed bar both have.
  it('OBV: a window that moved is no crossing by itself, a real move through the value across it is', async () => {
    const closes = [100, 101, ...Array.from({ length: 118 }, (_, i) => 100 + Math.sin((i + 2) / 3) * 5)]
    closes.push(closes[119]) // bar 120 does not move OBV
    closes.push(closes[120] + 10) // bar 121 rises on a huge volume
    const series = bars(closes).map((c, i) => (i === 121 ? { ...c, volume: 1e9 } : c))
    const [first, moved, movedAgain] = [series.slice(0, 120), series.slice(1, 121), series.slice(2, 122)]
    const [o1, o2] = [valueOf(first, 'obv.obv'), valueOf(moved, 'obv.obv')]
    expect(o2).toBe(o1 - first[1].volume) // the dropped bar 1 rose: only the base moved
    const alerts = [alert('obv', { source: 'obv.obv', target: 'value', value: (o1 + o2) / 2, operator: 'crosses', periods: {} })]

    await cycle(alerts, first)
    await cycle(alerts, moved)
    expect(updates).toEqual([])

    await cycle(alerts, movedAgain)
    expect(firedIds()).toEqual(['obv'])
    expect(mockSendTelegram.mock.calls[0][0]).toMatch(/^🔔 Alerta disparada: BTCUSDT: OBV cruza [\d.,]+ \(1h\) · para arriba\nAhora: OBV [\d.,]+$/)
  })
})

describe('no false crossing', () => {
  const n = crossAt(FALL_RISE, 'up', minus('price', 'ema50.ema50'))

  it('the first evaluation of an alert only records: a crossing before it existed never fires', async () => {
    const alerts = [alert('new', { operator: 'crosses_above' })]

    await cycle(alerts, FALL_RISE.slice(0, n))
    await cycle(alerts, FALL_RISE.slice(0, n + 1))

    expect(updates).toEqual([])
    nothingSent()
  })

  it('a restart forgets what the last evaluation saw: the next one only records', async () => {
    const alerts = [alert('r', { operator: 'crosses_above' })]

    await cycle(alerts, FALL_RISE.slice(0, n - 1))
    forgetConditionState()
    await cycle(alerts, FALL_RISE.slice(0, n))

    expect(updates).toEqual([])
    nothingSent()
  })

  it('a re-armed alert starts over: what it saw before firing is not its previous value', async () => {
    const alerts = [alert('again', { operator: 'crosses' })]
    await cycle(alerts, FALL_RISE.slice(0, n - 1))
    await cycle(alerts, FALL_RISE.slice(0, n))
    expect(firedIds()).toEqual(['again'])

    rows.get('again')!.status = 'active' // Reactivar
    await cycle(alerts, FALL_RISE.slice(0, n - 1)) // below again: "down" from the value it fired on

    expect(firedIds()).toEqual(['again'])
    expect(mockSendTelegram).toHaveBeenCalledOnce()
  })

  it('an edited condition starts over: the old line is not the new line', async () => {
    const fast = minus('price', 'ema50.ema50', { ema50: 10 })
    expect(fast(FALL_RISE.slice(0, n - 1))).toBeGreaterThanOrEqual(0) // the price is above the EMA 10 there
    await cycle([alert('edit', { operator: 'crosses_above', periods: { ema50: 50 } })], FALL_RISE.slice(0, n - 1))

    await cycle([alert('edit', { operator: 'crosses_above', periods: { ema50: 10 } })], FALL_RISE.slice(0, n - 1))

    expect(updates).toEqual([])
    nothingSent()
  })
})

describe('candles', () => {
  it('are fetched once per ticker and timeframe, however many alerts share them', async () => {
    mockFetchKlines.mockResolvedValue(FALL_RISE)
    mockGetCandles.mockResolvedValue(FALL_RISE.map((c) => ({ ...c, time: c.time })))
    const alerts = [
      alert('a', { operator: 'crosses_above' }),
      alert('b', { operator: 'crosses_below' }),
      alert('c', { source: 'rsi.rsi', target: 'value', value: 70, periods: { rsi: 14 } }),
      alert('d', { timeframe: '4h' }),
      alert('e', { ticker: 'ETHUSDT' }),
      alert('f', { ticker: 'AAPL', timeframe: '1d' }),
      alert('g', { ticker: 'AAPL', timeframe: '1d', source: 'ema20.ema20', periods: { ema20: 20, ema50: 50 } }),
    ]

    await evaluateConditionAlerts(db, alerts)

    expect(mockFetchKlines.mock.calls.sort()).toEqual([['BTCUSDT', '1h', 1000], ['BTCUSDT', '4h', 1000], ['ETHUSDT', '1h', 1000]])
    expect(mockGetCandles).toHaveBeenCalledOnce()
    expect(mockGetCandles).toHaveBeenCalledWith('AAPL', '1d', expect.any(Date))
  })

  it(`at most ${MAX_SERIES_PER_RUN} series a run, taking turns so every alert gets checked`, async () => {
    mockFetchKlines.mockResolvedValue(FALL_RISE)
    const alerts = Array.from({ length: MAX_SERIES_PER_RUN + 3 }, (_, i) => alert(`s${i}`, { ticker: `C${String(i).padStart(2, '0')}USDT` }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await evaluateConditionAlerts(db, alerts)
    const firstRun = mockFetchKlines.mock.calls.map((c) => c[0])
    mockFetchKlines.mockClear()
    await evaluateConditionAlerts(db, alerts)
    const secondRun = mockFetchKlines.mock.calls.map((c) => c[0])

    expect(firstRun).toHaveLength(MAX_SERIES_PER_RUN)
    expect(secondRun).toHaveLength(MAX_SERIES_PER_RUN)
    expect(new Set([...firstRun, ...secondRun]).size).toBe(MAX_SERIES_PER_RUN + 3)
    expect(warn).toHaveBeenCalledWith(`[Worker] condition alerts: ${MAX_SERIES_PER_RUN + 3} series, ${MAX_SERIES_PER_RUN} checked this run`)
    warn.mockRestore()
  })
})

describe('an alert that cannot be checked', () => {
  const notice = (reason: string, words = 'Precio cruza EMA 50 (1h) · cualquiera', ticker = 'BTCUSDT') => {
    expect(mockSendPush).toHaveBeenCalledOnce()
    expect(mockSendPush).toHaveBeenCalledWith(db, 'owner-1', {
      title: `No se puede revisar: ${ticker}`,
      body: `${words}. ${reason}. No se vigila hasta que la reactives.`,
      url: `/trading?symbol=${ticker}`,
      tag: expect.stringMatching(/^price-alert-/),
    })
    expect(mockSendTelegram).toHaveBeenCalledOnce()
    expect(mockSendTelegram).toHaveBeenCalledWith(`⚠️ No se puede revisar la alerta de ${ticker}: ${words}\n${reason}. No se vigila hasta que la reactives.`)
  }
  const failing = () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetchKlines.mockRejectedValue(new Error('klines 503'))
    return warn
  }

  it(`a failure that can pass marks nothing below ${TRANSIENT_FAILURE_LIMIT} in a row; a good load starts the count again`, async () => {
    const warn = failing()
    const alerts = [alert('t')]
    for (let i = 1; i < TRANSIENT_FAILURE_LIMIT; i++) await evaluateConditionAlerts(db, alerts)
    mockFetchKlines.mockResolvedValueOnce(FALL_RISE)
    await evaluateConditionAlerts(db, alerts)
    for (let i = 1; i < TRANSIENT_FAILURE_LIMIT; i++) await evaluateConditionAlerts(db, alerts)

    expect(updates).toEqual([])
    nothingSent()
    expect(warn).toHaveBeenCalledWith(`[Worker] condition alert candles BTCUSDT 1h: klines 503 (1/${TRANSIENT_FAILURE_LIMIT})`)
    warn.mockRestore()
  })

  it(`at ${TRANSIENT_FAILURE_LIMIT} in a row it moves to "No se puede revisar" and says so once, never again while it stays so`, async () => {
    const warn = failing()
    const alerts = [alert('t')]
    for (let i = 1; i <= TRANSIENT_FAILURE_LIMIT; i++) await evaluateConditionAlerts(db, alerts)

    expect(updates).toEqual([{ id: 't', patch: { status: 'unavailable' } }])
    notice(`No se pudieron traer las velas de BTCUSDT en 1h en ${TRANSIENT_FAILURE_LIMIT} intentos seguidos`)

    // A stale read (a slow query, a second worker) still lists it: the row is no longer active, nothing is sent.
    for (let i = 1; i <= TRANSIENT_FAILURE_LIMIT; i++) await evaluateConditionAlerts(db, alerts)
    expect(updates).toHaveLength(1)
    expect(mockSendPush).toHaveBeenCalledOnce()
    expect(mockSendTelegram).toHaveBeenCalledOnce()

    // Reactivar checks it again, from a count of zero.
    rows.get('t')!.status = 'active'
    await evaluateConditionAlerts(db, alerts)
    expect(updates).toHaveLength(1)
    warn.mockRestore()
  })

  const EMA200 = 'Precio cruza EMA 200 (1h) · cualquiera'
  const cases: [string, () => void, Partial<Alert>, string, string][] = [
    ['an unknown ticker', () => mockFetchKlines.mockRejectedValue(new Error('klines 400')), { ticker: 'NOPEUSDT' }, 'Precio cruza EMA 50 (1h) · cualquiera', 'No se encuentra NOPEUSDT'],
    ['no candles', () => mockFetchKlines.mockResolvedValue([]), {}, 'Precio cruza EMA 50 (1h) · cualquiera', 'No hay velas de BTCUSDT en 1h'],
    ['too few candles for its periods', () => mockFetchKlines.mockResolvedValue(FALL_RISE.slice(0, 120)), { target: 'ema200.ema200', periods: { ema200: 200 } }, EMA200, 'Las 120 velas de 1h no alcanzan para calcular EMA 200'],
  ]
  it.each(cases)('%s: at once, with why', async (_case, answer, fields, words, reason) => {
    answer()
    const a = alert('p', fields)

    await evaluateConditionAlerts(db, [a])

    expect(updates).toEqual([{ id: 'p', patch: { status: 'unavailable' } }])
    notice(reason, words, a.ticker)
  })
})

describe('the database row is the guard', () => {
  const n = crossAt(FALL_RISE, 'up', minus('price', 'ema50.ema50'))

  it('a crossing whose row already left "active" (another cycle or worker fired it) sends nothing', async () => {
    const alerts = [alert('x', { operator: 'crosses_above' })]
    await cycle(alerts, FALL_RISE.slice(0, n - 1))
    rows.get('x')!.status = 'triggered'

    await cycle(alerts, FALL_RISE.slice(0, n))

    expect(updates).toEqual([])
    nothingSent()
  })

  it('so does a notice whose row already left "active"', async () => {
    mockFetchKlines.mockRejectedValue(new Error('klines 400'))
    const alerts = [alert('y')]
    rows.get('y')!.status = 'unavailable'

    await evaluateConditionAlerts(db, alerts)

    expect(updates).toEqual([])
    nothingSent()
  })
})
