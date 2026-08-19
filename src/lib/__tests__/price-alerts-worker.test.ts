import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock sendTelegram so no real HTTP calls are made
const mockSendTelegram = vi.fn().mockResolvedValue({ ok: true })

vi.mock('../notifications', () => ({
  sendTelegram: mockSendTelegram,
  checkNotificationConfig: vi.fn(),
}))

// Build a minimal Supabase mock that tracks calls
let mockAlertsData: any[] = []
let mockFetchError: any = null
let mockUpdateError: any = null

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
      select: vi.fn().mockReturnValue({ eq: mockEqStatus }),
      update: mockUpdate,
    }
  }
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

    await evaluatePriceAlerts({ AAPL: 195 })

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

    await evaluatePriceAlerts({ MSFT: 298 })

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

    await evaluatePriceAlerts({ AAPL: 195 })

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

    await evaluatePriceAlerts({ MSFT: 295 })

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

    await evaluatePriceAlerts({ AAPL: 182 })

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

    await evaluatePriceAlerts({ TSLA: 255.5 })

    const msg: string = mockSendTelegram.mock.calls[0][0]
    expect(msg).toBe('🔔 Alerta disparada: TSLA ↑ 250\nPrecio actual: 255.5')
  })

  it('returns early when prices map is empty', async () => {
    await evaluatePriceAlerts({})

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
    await evaluatePriceAlerts({ AAPL: 195 })

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSendTelegram).not.toHaveBeenCalled()
  })
})
