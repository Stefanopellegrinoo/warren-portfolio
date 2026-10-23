import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock sendTelegram so no real HTTP calls are made
const mockSendTelegram = vi.fn().mockResolvedValue({ ok: true })

vi.mock('../notifications', async () => ({
  ...(await vi.importActual<typeof import('../notifications')>('../notifications')),
  sendTelegram: mockSendTelegram,
  checkNotificationConfig: vi.fn(),
}))

// Capture the BullMQ processor so the price job can be driven directly
let processor: (job: unknown) => Promise<void> = async () => {}
vi.mock('bullmq', () => ({ Worker: class { constructor(_q: string, fn: typeof processor) { processor = fn } on() {} } }))
vi.mock('../queue', () => ({ PRICE_QUEUE_NAME: 'q', PRICE_REPEAT_JOB_NAME: 'repeat', NIGHTLY_JOB_NAME: 's', TICKER_AUDIT_JOB_NAME: 't', ON_TERMS_JOB_NAME: 'o', FX_RATES_JOB_NAME: 'fx' }))
const mockFetchLkp = vi.fn(async () => new Map())
const mockFetchYahoo = vi.fn(async () => new Map())
vi.mock('../yahoo-finance', () => ({
  fetchQuotesFromYahoo: (...a: unknown[]) => mockFetchYahoo(...(a as [])),
  cachePrice: vi.fn(async () => {}),
  fetchQuotes: (...a: unknown[]) => mockFetchLkp(...(a as [])),
}))
vi.mock('../data912-client', () => ({ fetchData912Prices: vi.fn(async () => new Map()) }))
vi.mock('../redis', () => ({ getRedis: () => null }))
vi.mock('../summary-cache', () => ({ cacheUserSummaries: vi.fn() }))
vi.mock('../portfolio-valuation', () => ({
  splitQuotesByAssetClass: (m: Map<string, unknown>) => ({ stockQuotes: m, onQuotes: new Map() }),
}))
vi.mock('../utils', () => ({ isMarketOpen: () => true, argentinaDate: () => '2026-10-22' }))
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

  // select chain: .from('price_alerts').select('*').eq('status',…).eq('type',…).in('ticker',…)
  mockIn.mockResolvedValue({ data: mockAlertsData, error: mockFetchError })
  mockEqType.mockReturnValue({ in: mockIn })
  mockEqStatus.mockReturnValue({ eq: mockEqType })

  // update chain: .from('price_alerts').update(…).eq('id',…)
  mockEqUpdate.mockResolvedValue({ error: mockUpdateError })
  mockUpdate.mockReturnValue({ eq: mockEqUpdate })
})

const mockFrom = vi.fn().mockImplementation((table: string) => {
  if (table === 'price_alerts') {
    return {
      // select('ticker') is the alert-ticker lookup of the price job; select('*') the evaluation
      select: vi.fn((cols: string) => cols === 'ticker'
        ? { eq: () => ({ eq: async () => ({ data: mockAlertTickerRows, error: null }) }) }
        : { eq: mockEqStatus }),
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
    mockEqUpdate.mockResolvedValueOnce({ error: null })

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
    mockEqUpdate.mockResolvedValueOnce({ error: null })

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
    mockEqUpdate.mockResolvedValueOnce({ error: null })

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
    mockEqUpdate.mockResolvedValueOnce({ error: null })

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
