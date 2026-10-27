import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Candle } from '../binance/types'
import { INDICATOR_SPECS } from '../chart/indicator-specs'
import { DEFAULT_CONFIG } from '../store/chart-store'
import { MarketDataError } from '../market-data/types'

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock sendTelegram so no real HTTP calls are made
const mockSendTelegram = vi.fn().mockResolvedValue({ ok: true })

// Ledger reads load the stock splits (odd/tasks/split-aware-ledger.md T3): none in these tests.
vi.mock('@/lib/stock-splits', () => ({ loadSplits: async () => new Map() }))
vi.mock('../notifications', async () => ({
  ...(await vi.importActual<typeof import('../notifications')>('../notifications')),
  sendTelegram: mockSendTelegram,
  checkNotificationConfig: vi.fn(),
}))

// Push goes to the alert's owner; the payload builder stays real.
const mockSendPush = vi.fn().mockResolvedValue({ ok: true, sent: 1 })
vi.mock('../push', async () => ({
  ...(await vi.importActual<typeof import('../push')>('../push')),
  sendPushToUser: (...a: unknown[]) => mockSendPush(...a),
}))

// Capture the BullMQ processor so the price job can be driven directly
let processor: (job: unknown) => Promise<void> = async () => {}
vi.mock('bullmq', () => ({ Worker: class { constructor(_q: string, fn: typeof processor) { processor = fn } on() {} } }))
vi.mock('../queue', () => ({ ON_PRICES_PERSIST_JOB_NAME: 'on-prices-persist', PRICE_QUEUE_NAME: 'q', PRICE_REPEAT_JOB_NAME: 'repeat', NIGHTLY_JOB_NAME: 's', TICKER_AUDIT_JOB_NAME: 't', ON_TERMS_JOB_NAME: 'o', FX_RATES_JOB_NAME: 'fx', SPLITS_INGEST_JOB_NAME: 'splits' }))
const mockFetchLkp = vi.fn(async () => new Map())
const mockFetchYahoo = vi.fn(async () => new Map())
vi.mock('../yahoo-finance', () => ({
  fetchQuotesFromYahoo: (...a: unknown[]) => mockFetchYahoo(...(a as [])),
  cachePrice: vi.fn(async () => {}),
  fetchQuotes: (...a: unknown[]) => mockFetchLkp(...(a as [])),
}))
vi.mock('../data912-client', () => ({ fetchData912Prices: vi.fn(async () => new Map()) }))
vi.mock('../redis', () => ({ getRedis: () => null }))
// The held tickers come from the cycle's ledgers, read through the fake database below.
vi.mock('../summary-cache', () => ({
  cacheUserSummaries: vi.fn(),
  loadCycleLedgers: async () => (await import('../ledger-now')).loadAllLedgers((await import('../supabase-server')).createServiceClient()),
}))
vi.mock('../portfolio-valuation', () => ({
  splitQuotesByAssetClass: (m: Map<string, unknown>) => ({ stockQuotes: m, onQuotes: new Map() }),
}))
let mockMarketOpen = true
vi.mock('../utils', async () => ({
  ...(await vi.importActual<typeof import('../utils')>('../utils')),
  isMarketOpen: () => mockMarketOpen,
  argentinaDate: () => '2026-10-22',
}))
const mockFetchCrypto = vi.fn(async () => new Map())
// Candles of the alerts on an indicator line (odd/tasks/chart-customization.md S7): Binance for crypto, the market-data provider for the rest.
const mockFetchKlines = vi.fn(async (..._a: unknown[]): Promise<Candle[]> => [])
vi.mock('../binance/rest', () => ({
  fetchCryptoQuotes: (...a: unknown[]) => mockFetchCrypto(...(a as [])),
  fetchServerKlines: (...a: unknown[]) => mockFetchKlines(...a),
}))
const mockGetCandles = vi.fn(async (..._a: unknown[]): Promise<unknown[]> => [])
vi.mock('../market-data', async () => ({
  getMarketDataProvider: () => ({ getCandles: (...a: unknown[]) => mockGetCandles(...a) }),
  MarketDataError: (await import('../market-data/types')).MarketDataError,
}))
vi.mock('../import-worker', () => ({ startImportWorker: vi.fn() }))
vi.mock('../signals-worker', () => ({ startSignalsWorker: vi.fn() }))
vi.mock('../job-health', () => ({ beat: vi.fn(), alertJobFailure: vi.fn(), recordRefresh: vi.fn() }))
vi.mock('../worker-startup', () => ({ ensureRedisAndScheduleJobs: vi.fn(async () => ({})), resolveStartupOutcome: () => ({ exit: false }) }))
vi.mock('../ticker-audit', () => ({ auditTickerIdentities: vi.fn() }))
vi.mock('../on-price-history', () => ({ captureOnPriceHistory: vi.fn() }))

// Build a minimal Supabase mock that tracks calls
let mockAlertsData: any[] = []
let mockFetchError: any = null
let mockUpdateError: any = null
let mockPositionRows: { ticker: string }[] = []
let mockOnRows: { ticker: string }[] = []
let mockAlertTickerRows: { ticker: string }[] = []

const mockSingle = vi.fn()
const mockUpdate = vi.fn()
const mockEqUpdate = vi.fn()
const mockEqActive = vi.fn()
const mockSelectColumns = vi.fn()
// The database guard: an update `.eq('status', 'active')` changes a row once; ids here already left 'active'.
let mockLeftActive = new Set<string>()
const mockIn = vi.fn()
const mockEqStatus = vi.fn()
const mockEqType = vi.fn()

// Reset chain mocks before each test
beforeEach(() => {
  vi.clearAllMocks()
  mockAlertsData = []
  mockFetchError = null
  mockUpdateError = null
  mockPositionRows = []
  mockOnRows = []
  mockAlertTickerRows = []
  mockMarketOpen = true

  // select chain: .from('price_alerts').select('*').eq('status',…).eq('type',…).in('ticker',…)
  // mockReset drops a once-answer a test left unused, so it cannot leak into the next test.
  mockIn.mockReset()
  mockIn.mockResolvedValue({ data: mockAlertsData, error: mockFetchError })
  mockFetchKlines.mockReset()
  mockFetchKlines.mockResolvedValue([])
  mockGetCandles.mockReset()
  mockGetCandles.mockResolvedValue([])
  mockEqType.mockReturnValue({ in: mockIn })
  mockEqStatus.mockReturnValue({ eq: mockEqType })

  // update chain: .from('price_alerts').update(…).eq('id',…).eq('status','active').select('id')
  mockLeftActive = new Set()
  mockEqUpdate.mockImplementation((_column: string, id: string) => ({
    eq: (...a: unknown[]) => {
      mockEqActive(...a)
      return {
        select: async () => {
          if (mockUpdateError) return { data: null, error: mockUpdateError }
          if (mockLeftActive.has(id)) return { data: [], error: null }
          mockLeftActive.add(id)
          return { data: [{ id }], error: null }
        },
      }
    },
  }))
  mockUpdate.mockReturnValue({ eq: mockEqUpdate })
  forgetConditionState()
})

const mockFrom = vi.fn().mockImplementation((table: string) => {
  if (table === 'price_alerts') {
    return {
      // select('ticker') is the alert-ticker lookup of the price job; select('*') the evaluation
      select: vi.fn((cols: string) => {
        mockSelectColumns(cols)
        return cols === 'ticker'
          ? { eq: () => ({ eq: async () => ({ data: mockAlertTickerRows, error: null }) }) }
          : { eq: mockEqStatus }
      }),
      update: mockUpdate,
    }
  }
  // Held tickers come from the ledger core (odd/tasks/nucleo-ledger.md T4.2b): one buy per held row.
  if (table === 'transactions' || table === 'cash_movements' || table === 'on_payment_overrides') {
    const rows = table !== 'transactions' ? [] : mockPositionRows.map((r: any) => ({
      user_id: 'u1', operation: 'COMPRA', quantity: 1, price: 1, commission: 0, date: '2026-01-01', asset_type: 'ACCION', created_at: null, ...r,
    }))
    const q: any = { select: () => q, order: () => q, range: async () => ({ data: rows, error: null }) }
    return q
  }
  if (table === 'ons') return { select: async () => ({ data: mockOnRows, error: null }) }
  return {}
})

vi.mock('../supabase-server', () => ({
  createServiceClient: vi.fn(() => ({
    from: mockFrom,
  })),
  createServerClientInstance: vi.fn(),
}))

// ── Import evaluatePriceAlerts after mocks are set up ─────────────────────────

const { evaluatePriceAlerts } = await import('../price-worker')
const { forgetConditionState } = await import('../alert-evaluator')
// Let the startup fetch in main() settle before the first test clears the mocks
await new Promise(r => setTimeout(r, 0))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('evaluatePriceAlerts', () => {
  it('fires alert when crosses_above condition is met', async () => {
    mockAlertsData.push({
      id: 'alert-1',
      ticker: 'AAPL',
      operator: 'crosses_above',
      value: 190,
      name: 'AAPL-price-190-above',
    })
    mockIn.mockResolvedValueOnce({ data: mockAlertsData, error: null })

    await evaluatePriceAlerts({ AAPL: 195 }, { AAPL: 185 })

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'triggered' })
    )
    expect(mockSendTelegram).toHaveBeenCalledOnce()
    const msg: string = mockSendTelegram.mock.calls[0][0]
    expect(msg).toContain('AAPL')
    expect(msg).toContain('↑')
    expect(msg).toContain('190')
    expect(msg).toContain('195')
  })

  it('fires alert when crosses_below condition is met', async () => {
    mockAlertsData.push({
      id: 'alert-2',
      ticker: 'MSFT',
      operator: 'crosses_below',
      value: 300,
      name: 'MSFT-price-300-below',
    })
    mockIn.mockResolvedValueOnce({ data: mockAlertsData, error: null })

    await evaluatePriceAlerts({ MSFT: 298 }, { MSFT: 305 })

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'triggered' })
    )
    expect(mockSendTelegram).toHaveBeenCalledOnce()
    const msg: string = mockSendTelegram.mock.calls[0][0]
    expect(msg).toContain('MSFT')
    expect(msg).toContain('↓')
    expect(msg).toContain('300')
    expect(msg).toContain('298')
  })

  it('does NOT fire when crosses_above condition is not met', async () => {
    mockAlertsData.push({
      id: 'alert-3',
      ticker: 'AAPL',
      operator: 'crosses_above',
      value: 200,
      name: 'AAPL-price-200-above',
    })
    mockIn.mockResolvedValueOnce({ data: mockAlertsData, error: null })

    await evaluatePriceAlerts({ AAPL: 195 }, { AAPL: 185 })

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSendTelegram).not.toHaveBeenCalled()
  })

  it('does NOT fire when crosses_below condition is not met', async () => {
    mockAlertsData.push({
      id: 'alert-4',
      ticker: 'MSFT',
      operator: 'crosses_below',
      value: 290,
      name: 'MSFT-price-290-below',
    })
    mockIn.mockResolvedValueOnce({ data: mockAlertsData, error: null })

    await evaluatePriceAlerts({ MSFT: 295 }, { MSFT: 305 })

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSendTelegram).not.toHaveBeenCalled()
  })

  it('sets status to "triggered" and triggered_at when alert fires', async () => {
    mockAlertsData.push({
      id: 'alert-5',
      ticker: 'AAPL',
      operator: 'crosses_above',
      value: 180,
      name: 'AAPL-price-180-above',
    })
    mockIn.mockResolvedValueOnce({ data: mockAlertsData, error: null })

    await evaluatePriceAlerts({ AAPL: 182 }, { AAPL: 175 })

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'triggered',
        triggered_at: expect.any(String),
      })
    )
  })

  it('sends Telegram message with correct format on trigger', async () => {
    mockAlertsData.push({
      id: 'alert-6',
      ticker: 'TSLA',
      operator: 'crosses_above',
      value: 250,
      name: 'TSLA-price-250-above',
    })
    mockIn.mockResolvedValueOnce({ data: mockAlertsData, error: null })

    await evaluatePriceAlerts({ TSLA: 255.5 }, { TSLA: 240 })

    const msg: string = mockSendTelegram.mock.calls[0][0]
    expect(msg).toBe('🔔 Alerta disparada: TSLA ↑ 250\nPrecio actual: 255.5')
  })

  it('returns early when prices map is empty', async () => {
    await evaluatePriceAlerts({}, {})

    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockSendTelegram).not.toHaveBeenCalled()
  })

  it('skips alert gracefully when ticker not found in prices', async () => {
    mockAlertsData.push({
      id: 'alert-7',
      ticker: 'NVDA',
      operator: 'crosses_above',
      value: 500,
      name: 'NVDA-price-500-above',
    })
    mockIn.mockResolvedValueOnce({ data: mockAlertsData, error: null })

    // NVDA not in prices map
    await evaluatePriceAlerts({ AAPL: 195 }, { AAPL: 185 })

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSendTelegram).not.toHaveBeenCalled()
  })
})

// odd/tasks/push-notificaciones.md S4: a fired alert reaches its owner's devices; a push failure never stops the worker.
describe('evaluatePriceAlerts push', () => {
  it('sends the push to the owner of the alert, after marking it triggered', async () => {
    mockAlertsData.push({ id: 'alert-p1', user_id: 'owner-1', ticker: 'AAPL', operator: 'crosses_above', value: 190, name: 'x' })
    mockIn.mockResolvedValueOnce({ data: mockAlertsData, error: null })

    await evaluatePriceAlerts({ AAPL: 195.5 }, { AAPL: 185 })

    expect(mockSendPush).toHaveBeenCalledOnce()
    const [client, userId, payload] = mockSendPush.mock.calls[0]
    expect(client).toHaveProperty('from')
    expect(userId).toBe('owner-1')
    expect(payload).toEqual({ title: 'Alerta de precio: AAPL', body: 'Superó 190. Ahora: 195,5', url: '/trading?symbol=AAPL', tag: 'price-alert-alert-p1' })
    expect(mockUpdate.mock.invocationCallOrder[0]).toBeLessThan(mockSendPush.mock.invocationCallOrder[0])
  })

  it('a failed push is logged and the next alert still fires', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockSendPush.mockResolvedValueOnce({ ok: false, error: 'no device accepted the push' })
    mockAlertsData.push(
      { id: 'alert-p2', user_id: 'owner-1', ticker: 'AAPL', operator: 'crosses_above', value: 190, name: 'x' },
      { id: 'alert-p3', user_id: 'owner-2', ticker: 'MSFT', operator: 'crosses_below', value: 400, name: 'y' },
    )
    mockIn.mockResolvedValueOnce({ data: mockAlertsData, error: null })

    await evaluatePriceAlerts({ AAPL: 195, MSFT: 390 }, { AAPL: 185, MSFT: 410 })

    expect(mockSendPush).toHaveBeenCalledTimes(2)
    expect(mockSendPush.mock.calls[1][1]).toBe('owner-2')
    expect(mockSendTelegram).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith('[Worker] push for alert alert-p2: no device accepted the push')
    warn.mockRestore()
  })

  it('a user without devices is not an error worth logging', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockSendPush.mockResolvedValueOnce({ ok: false, error: 'no devices' })
    mockAlertsData.push({ id: 'alert-p4', user_id: 'owner-1', ticker: 'AAPL', operator: 'crosses_above', value: 190, name: 'x' })
    mockIn.mockResolvedValueOnce({ data: mockAlertsData, error: null })

    await evaluatePriceAlerts({ AAPL: 195 }, { AAPL: 185 })

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('evaluatePriceAlerts fires only on a real cross', () => {
  it('does NOT fire crosses_above when the previous price was already at or above the line', async () => {
    mockIn.mockResolvedValueOnce({
      data: [{ id: 'a', ticker: 'AAPL', operator: 'crosses_above', value: 190, name: 'n' }],
      error: null,
    })

    await evaluatePriceAlerts({ AAPL: 196 }, { AAPL: 195 })

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSendTelegram).not.toHaveBeenCalled()
  })

  it('does NOT fire crosses_below when the previous price was already at or below the line', async () => {
    mockIn.mockResolvedValueOnce({
      data: [{ id: 'b', ticker: 'MSFT', operator: 'crosses_below', value: 300, name: 'n' }],
      error: null,
    })

    await evaluatePriceAlerts({ MSFT: 290 }, { MSFT: 295 })

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSendTelegram).not.toHaveBeenCalled()
  })

  it('does NOT fire when there is no previous price for the ticker', async () => {
    mockIn.mockResolvedValueOnce({
      data: [{ id: 'c', ticker: 'AAPL', operator: 'crosses_above', value: 190, name: 'n' }],
      error: null,
    })

    await evaluatePriceAlerts({ AAPL: 195 }, {})

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSendTelegram).not.toHaveBeenCalled()
  })
})

const quote = (ticker: string, price: number) => ({ ticker, price, change: 0, changePercent: 0, previousClose: price, updatedAt: '2026-10-22T15:00:00Z' })

describe('periodic price job', () => {
  it('fetches and evaluates tickers that have an active alert but no position, with the LKP as the previous price', async () => {
    mockPositionRows = [{ ticker: 'AAPL' }]
    mockOnRows = [{ ticker: 'YMCXO' }]
    mockAlertTickerRows = [{ ticker: 'TSLA' }, { ticker: 'YMCXO' }]
    mockFetchLkp.mockResolvedValueOnce(new Map([['TSLA', quote('TSLA', 240)]]))
    mockFetchYahoo.mockResolvedValueOnce(new Map([['AAPL', quote('AAPL', 200)], ['TSLA', quote('TSLA', 255)]]))
    mockIn.mockResolvedValueOnce({
      data: [{ id: 'tsla-1', ticker: 'TSLA', operator: 'crosses_above', value: 250, name: 'n' }],
      error: null,
    })

    await processor({ name: 'repeat', data: {} })

    const yahooTickers = (mockFetchYahoo.mock.calls[0] as unknown as [string[]])[0]
    expect([...yahooTickers].sort()).toEqual(['AAPL', 'TSLA']) // the ON alert ticker stays on Data912
    expect(mockIn.mock.calls[0][1]).toContain('TSLA')
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'triggered', triggered_at: expect.any(String) }))
    expect(mockEqUpdate).toHaveBeenCalledWith('id', 'tsla-1')
    expect(mockSendTelegram).toHaveBeenCalledWith('🔔 Alerta disparada: TSLA ↑ 250\nPrecio actual: 255')
  })

  it('still fetches and evaluates position tickers', async () => {
    mockPositionRows = [{ ticker: 'AAPL' }]
    mockFetchLkp.mockResolvedValueOnce(new Map([['AAPL', quote('AAPL', 199)]]))
    mockFetchYahoo.mockResolvedValueOnce(new Map([['AAPL', quote('AAPL', 201)]]))
    mockIn.mockResolvedValueOnce({
      data: [{ id: 'aapl-1', ticker: 'AAPL', operator: 'crosses_above', value: 200, name: 'n' }],
      error: null,
    })

    await processor({ name: 'repeat', data: {} })

    expect((mockFetchYahoo.mock.calls[0] as unknown as [string[]])[0]).toEqual(['AAPL'])
    expect(mockIn.mock.calls[0][1]).toEqual(['AAPL'])
    expect(mockEqUpdate).toHaveBeenCalledWith('id', 'aapl-1')
    expect(mockSendTelegram).toHaveBeenCalledOnce()
  })
})

describe('periodic price job with condition alerts', () => {
  it('checks a condition alert whose ticker got no price, and an unknown ticker gets its one notice', async () => {
    mockAlertTickerRows = [{ ticker: 'NOPE' }]
    mockGetCandles.mockRejectedValueOnce(new MarketDataError('NOT_FOUND', 'No data found, symbol may be delisted'))
    mockIn.mockResolvedValueOnce({
      data: [{ id: 'nope-1', user_id: 'owner-1', ticker: 'NOPE', operator: 'crosses', value: null, source: 'price', target: 'ema50.ema50', timeframe: '1d', periods: { ema50: 50 }, name: 'n' }],
      error: null,
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await processor({ name: 'repeat', data: {} })

    expect(mockIn.mock.calls[0][1]).toEqual(['NOPE'])
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'unavailable' })
    expect(mockEqUpdate).toHaveBeenCalledWith('id', 'nope-1')
    const why = 'No se encuentra NOPE. No se vigila hasta que la reactives.'
    expect(mockSendPush).toHaveBeenCalledWith(expect.anything(), 'owner-1', { title: 'No se puede revisar: NOPE', body: `Precio cruza EMA 50 (1D) · cualquiera. ${why}`, url: '/trading?symbol=NOPE', tag: 'price-alert-nope-1' })
    expect(mockSendTelegram).toHaveBeenCalledWith(`⚠️ No se puede revisar la alerta de NOPE: Precio cruza EMA 50 (1D) · cualquiera\n${why}`)
    warn.mockRestore()
  })
})

describe('crypto alerts', () => {
  const btcAlert = { id: 'btc-1', user_id: 'owner-btc', ticker: 'BTCUSDT', operator: 'crosses_above', value: 80000, name: 'n' }

  it('are checked with the market closed, with Binance prices', async () => {
    mockMarketOpen = false
    mockAlertTickerRows = [{ ticker: 'BTCUSDT' }, { ticker: 'AAPL' }]
    mockFetchLkp.mockResolvedValueOnce(new Map([['BTCUSDT', quote('BTCUSDT', 79900)]]))
    mockFetchCrypto.mockResolvedValueOnce(new Map([['BTCUSDT', quote('BTCUSDT', 80100)]]))
    mockIn.mockResolvedValueOnce({ data: [btcAlert], error: null })

    await processor({ name: 'repeat', data: {} })

    expect(mockFetchCrypto).toHaveBeenCalledWith(['BTCUSDT'])
    expect(mockFetchYahoo).not.toHaveBeenCalled()
    expect(mockIn.mock.calls[0][1]).toEqual(['BTCUSDT'])
    expect(mockEqUpdate).toHaveBeenCalledWith('id', 'btc-1')
    expect(mockSendPush).toHaveBeenCalledWith(expect.anything(), 'owner-btc', expect.objectContaining({ url: '/trading?symbol=BTCUSDT' }))
  })

  it('never go to Yahoo with the market open', async () => {
    mockAlertTickerRows = [{ ticker: 'BTCUSDT' }, { ticker: 'TSLA' }]
    mockFetchCrypto.mockResolvedValueOnce(new Map([['BTCUSDT', quote('BTCUSDT', 79000)]]))

    await processor({ name: 'repeat', data: {} })

    expect(mockFetchCrypto).toHaveBeenCalledWith(['BTCUSDT'])
    expect((mockFetchYahoo.mock.calls[0] as unknown as [string[]])[0]).toEqual(['TSLA'])
  })

  it('a Binance failure is logged and the stock cycle still runs', async () => {
    mockAlertTickerRows = [{ ticker: 'BTCUSDT' }, { ticker: 'TSLA' }]
    mockFetchCrypto.mockRejectedValueOnce(new Error('binance 451'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await processor({ name: 'repeat', data: {} })

    expect(errorSpy).toHaveBeenCalledWith('[Worker] Crypto alerts failed:', expect.any(Error))
    expect(mockFetchYahoo).toHaveBeenCalledOnce()
    errorSpy.mockRestore()
  })
})

// odd/tasks/chart-customization.md S6/S7: the price against a value fires on this cycle's quotes, as always;
// every other condition is checked on its candles (alert-evaluator.ts), never on the price crossing a number.
describe('evaluatePriceAlerts with conditions', () => {
  const evaluate = async (alert: Record<string, unknown>, now: number, before: number) => {
    mockIn.mockResolvedValueOnce({ data: [{ id: 'c1', user_id: 'owner-1', ticker: 'FXI', name: 'n', ...alert }], error: null })
    await evaluatePriceAlerts({ FXI: now }, { FXI: before })
  }
  const nothingFired = () => {
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSendTelegram).not.toHaveBeenCalled()
    expect(mockSendPush).not.toHaveBeenCalled()
  }

  // Daily bars; what the EMA 50 is comes from the chart's own line.
  const bars = (closes: number[]): Candle[] => closes.map((close, i) => ({ time: 1_760_000_000 + i * 86_400, open: close, high: close + 1, low: close - 1, close, volume: 1000 }))
  const FLAT = bars(Array.from({ length: 60 }, (_, i) => 100 + (i % 2)))
  const FALL_RISE = bars([...Array.from({ length: 100 }, (_, i) => 200 - i), ...Array.from({ length: 60 }, (_, i) => 101 + 2 * i)])
  const aboveEma50 = (c: Candle[]) => c.at(-1)!.close >= INDICATOR_SPECS.ema50.lines(c, DEFAULT_CONFIG)[0].data.at(-1)!.value
  const crossUp = Array.from({ length: FALL_RISE.length }, (_, n) => n).find((n) => n > 50 && !aboveEma50(FALL_RISE.slice(0, n - 1)) && aboveEma50(FALL_RISE.slice(0, n)))!

  it('an indicator source is checked on its candles: the price crossing 70 never fires "RSI crosses 70"', async () => {
    mockGetCandles.mockResolvedValue(FLAT)
    const rsi = { source: 'rsi.rsi', target: 'value', operator: 'crosses_above', value: 70, timeframe: '1h', periods: { rsi: 14 } }

    await evaluate(rsi, 65, 60)
    await evaluate(rsi, 75, 65)

    expect(mockGetCandles).toHaveBeenCalledTimes(2)
    expect(mockGetCandles).toHaveBeenCalledWith('FXI', '1h', expect.any(Date))
    nothingFired()
  })

  it('the price against a line fires on its candles, between one cycle and the next, once', async () => {
    mockGetCandles.mockResolvedValueOnce(FALL_RISE.slice(0, crossUp - 1)).mockResolvedValueOnce(FALL_RISE.slice(0, crossUp)).mockResolvedValueOnce(FALL_RISE.slice(0, crossUp + 1))
    const ema = { source: 'price', target: 'ema50.ema50', operator: 'crosses_above', value: null, timeframe: '1d', periods: { ema50: 50 } }

    await evaluate(ema, 1, 0)
    expect(mockUpdate).not.toHaveBeenCalled()
    await evaluate(ema, 1, 0)
    await evaluate(ema, 1, 0)

    expect(mockUpdate).toHaveBeenCalledOnce()
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'triggered', triggered_at: expect.any(String) })
    expect(mockEqUpdate).toHaveBeenCalledWith('id', 'c1')
    expect(mockEqActive).toHaveBeenCalledWith('status', 'active')
    expect(mockSendPush).toHaveBeenCalledOnce()
    expect(mockSendPush).toHaveBeenCalledWith(expect.anything(), 'owner-1', expect.objectContaining({ title: 'Alerta: FXI', url: '/trading?symbol=FXI', tag: 'price-alert-c1' }))
    expect(mockSendTelegram).toHaveBeenCalledOnce()
    expect(mockSendTelegram.mock.calls[0][0]).toMatch(/^🔔 Alerta disparada: FXI: Precio cruza EMA 50 \(1D\) · para arriba\nAhora: Precio [\d.,]+ · EMA 50 [\d.,]+$/)
  })

  // T6 review R3: a row read without source and target would look like the price against a value, so
  // "RSI crosses 70" would fire when the price crosses 70 and a line target would be Number(null) = 0.
  it('reads every column a condition needs (migration 052), or the whole row', async () => {
    const needed = ['id', 'user_id', 'ticker', 'operator', 'value', 'source', 'target', 'timeframe', 'periods']

    await evaluate({ source: 'price', target: 'value', operator: 'crosses_above', value: 32.5 }, 33, 32)

    const columns = mockSelectColumns.mock.calls.map((c) => c[0] as string).filter((c) => c !== 'ticker')
    expect(columns).toHaveLength(1)
    const read = columns[0].trim() === '*' ? needed : columns[0].split(',').map((c) => c.trim())
    expect(read).toEqual(expect.arrayContaining(needed))
  })

  it('a price alert whose row already left "active" (another cycle or worker fired it) sends nothing', async () => {
    mockLeftActive.add('c1')

    await evaluate({ source: 'price', target: 'value', operator: 'crosses_above', value: 32.5 }, 33, 32)

    expect(mockEqUpdate).toHaveBeenCalledWith('id', 'c1')
    expect(mockEqActive).toHaveBeenCalledWith('status', 'active')
    expect(mockSendTelegram).not.toHaveBeenCalled()
    expect(mockSendPush).not.toHaveBeenCalled()
  })

  it('the price crossing a value either way fires going up, and says it went up', async () => {
    await evaluate({ source: 'price', target: 'value', operator: 'crosses', value: 32.5 }, 33, 32)

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'triggered', triggered_at: expect.any(String) }))
    expect(mockEqUpdate).toHaveBeenCalledWith('id', 'c1')
    expect(mockSendTelegram).toHaveBeenCalledWith('🔔 Alerta disparada: FXI ↑ 32.5\nPrecio actual: 33')
    expect(mockSendPush).toHaveBeenCalledWith(expect.anything(), 'owner-1', expect.objectContaining({ body: 'Superó 32,5. Ahora: 33' }))
  })

  it('and going down, and says it went down', async () => {
    await evaluate({ source: 'price', target: 'value', operator: 'crosses', value: 32.5 }, 32, 33)

    expect(mockEqUpdate).toHaveBeenCalledWith('id', 'c1')
    expect(mockSendTelegram).toHaveBeenCalledWith('🔔 Alerta disparada: FXI ↓ 32.5\nPrecio actual: 32')
    expect(mockSendPush).toHaveBeenCalledWith(expect.anything(), 'owner-1', expect.objectContaining({ body: 'Bajó de 32,5. Ahora: 32' }))
  })

  it('either way does not fire without a cross', async () => {
    await evaluate({ source: 'price', target: 'value', operator: 'crosses', value: 32.5 }, 34, 33)

    nothingFired()
  })

  it('a price alert with the new columns at their defaults fires as before', async () => {
    await evaluate({ source: 'price', target: 'value', operator: 'crosses_above', value: 32.5, timeframe: null, periods: null, color: '#f23645' }, 33, 32)

    expect(mockSendTelegram).toHaveBeenCalledWith('🔔 Alerta disparada: FXI ↑ 32.5\nPrecio actual: 33')
  })
})
