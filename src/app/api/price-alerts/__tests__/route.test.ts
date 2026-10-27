import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock auth ─────────────────────────────────────────────────────────────────
const mockRequireUser = vi.fn()
const mockIsAuthFailure = vi.fn()
vi.mock('@/lib/api-auth', () => ({
  requireUser: mockRequireUser,
  isAuthFailure: mockIsAuthFailure,
}))

// ── Rate limit: allowed unless a test says otherwise ──────────────────────────
const mockRateLimit = vi.fn(async () => true)
// A new alert moves the alerts version, so the worker reads the active alerts again (S4).
const mockBumpAlerts = vi.fn()
vi.mock('@/lib/redis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/redis')>()),
  bumpAlertsVersion: () => mockBumpAlerts(),
}))

vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit: (...a: unknown[]) => mockRateLimit(...(a as [])),
}))

// ── Supabase mock (injected via requireUser result) ───────────────────────────
const mockFrom = vi.fn()
const mockSupabase = { from: mockFrom }

const fakeUser = { id: 'user-1' }

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeGetRequest(query = '') {
  return new NextRequest(`http://localhost/api/price-alerts${query}`, { method: 'GET' })
}

function makePostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/price-alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const fakeAlert = {
  id: 'alert-1',
  user_id: 'user-1',
  ticker: 'AAPL',
  type: 'price',
  operator: 'crosses_above',
  value: 195,
  name: 'AAPL-price-195-above',
  channel: 'telegram',
  status: 'active',
  created_at: '2026-05-20T10:00:00Z',
  triggered_at: null,
}

// ── GET tests ─────────────────────────────────────────────────────────────────

describe('GET /api/price-alerts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: fakeUser, supabase: mockSupabase })
    mockIsAuthFailure.mockReturnValue(false)
  })

  it('returns 401 when not authenticated', async () => {
    mockRequireUser.mockResolvedValue({ error: new Response(null, { status: 401 }) })
    mockIsAuthFailure.mockReturnValue(true)

    const { GET } = await import('../route')
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(401)
  })

  it('returns 200 with empty array when user has no alerts', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    const { GET } = await import('../route')
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.alerts).toEqual([])
  })

  it('returns 200 with alerts array when user has alerts', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [fakeAlert], error: null }),
    })

    const { GET } = await import('../route')
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.alerts).toHaveLength(1)
    expect(body.alerts[0].id).toBe('alert-1')
    expect(body.alerts[0].ticker).toBe('AAPL')
  })

  it('filters by ticker when ?ticker= is given', async () => {
    const eq = vi.fn().mockReturnThis()
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq,
      order: vi.fn().mockResolvedValue({ data: [fakeAlert], error: null }),
    })

    const { GET } = await import('../route')
    const res = await GET(makeGetRequest('?ticker=AAPL'))
    expect(res.status).toBe(200)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(eq).toHaveBeenCalledWith('ticker', 'AAPL')
    const body = await res.json()
    expect(body.alerts).toEqual([fakeAlert])
  })

  it('lists every ticker of the user when no ticker is given', async () => {
    const eq = vi.fn().mockReturnThis()
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq,
      order: vi.fn().mockResolvedValue({ data: [fakeAlert], error: null }),
    })

    const { GET } = await import('../route')
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)
    expect(eq).toHaveBeenCalledTimes(1)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('returns 500 when Supabase returns an error', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
    })

    const { GET } = await import('../route')
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(500)
  })
})

// ── POST tests ────────────────────────────────────────────────────────────────

describe('POST /api/price-alerts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: fakeUser, supabase: mockSupabase })
    mockIsAuthFailure.mockReturnValue(false)
  })

  it('returns 401 when not authenticated', async () => {
    mockRequireUser.mockResolvedValue({ error: new Response(null, { status: 401 }) })
    mockIsAuthFailure.mockReturnValue(true)

    const { POST } = await import('../route')
    const res = await POST(makePostRequest({ ticker: 'AAPL', type: 'price', operator: 'crosses_above', value: 195, name: 'AAPL-price-195-above' }))
    expect(res.status).toBe(401)
  })

  it('returns 201 with created alert when all fields are valid', async () => {
    mockFrom.mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: fakeAlert, error: null }),
    })

    const { POST } = await import('../route')
    const res = await POST(makePostRequest({
      ticker: 'AAPL',
      type: 'price',
      operator: 'crosses_above',
      value: 195,
      name: 'AAPL-price-195-above',
    }))

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.alert.id).toBe('alert-1')
    expect(body.alert.ticker).toBe('AAPL')
    expect(mockBumpAlerts).toHaveBeenCalledTimes(1)
  })

  it('returns 400 when ticker is missing', async () => {
    const { POST } = await import('../route')
    const res = await POST(makePostRequest({
      type: 'price',
      operator: 'crosses_above',
      value: 195,
      name: 'AAPL-price-195-above',
    }))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('returns 400 when type is missing', async () => {
    const { POST } = await import('../route')
    const res = await POST(makePostRequest({
      ticker: 'AAPL',
      operator: 'crosses_above',
      value: 195,
      name: 'AAPL-price-195-above',
    }))

    expect(res.status).toBe(400)
  })

  it('returns 400 when operator is missing', async () => {
    const { POST } = await import('../route')
    const res = await POST(makePostRequest({
      ticker: 'AAPL',
      type: 'price',
      value: 195,
      name: 'AAPL-price-195-above',
    }))

    expect(res.status).toBe(400)
  })

  it('returns 400 when value is missing', async () => {
    const { POST } = await import('../route')
    const res = await POST(makePostRequest({
      ticker: 'AAPL',
      type: 'price',
      operator: 'crosses_above',
      name: 'AAPL-price-195-above',
    }))

    expect(res.status).toBe(400)
  })

  it('returns 400 when name is missing', async () => {
    const { POST } = await import('../route')
    const res = await POST(makePostRequest({
      ticker: 'AAPL',
      type: 'price',
      operator: 'crosses_above',
      value: 195,
    }))

    expect(res.status).toBe(400)
  })

  it('returns 400 when body is empty object', async () => {
    const { POST } = await import('../route')
    const res = await POST(makePostRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 400 when body is invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/price-alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })

    const { POST } = await import('../route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 500 when Supabase returns an error on insert', async () => {
    mockFrom.mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
    })

    const { POST } = await import('../route')
    const res = await POST(makePostRequest({
      ticker: 'AAPL',
      type: 'price',
      operator: 'crosses_above',
      value: 195,
      name: 'AAPL-price-195-above',
    }))

    expect(res.status).toBe(500)
  })
})

// odd/tasks/chart-customization.md S6: alert conditions like TradingView. Old bodies keep their meaning.
describe('POST /api/price-alerts conditions', () => {
  let insert: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: fakeUser, supabase: mockSupabase })
    mockIsAuthFailure.mockReturnValue(false)
    mockRateLimit.mockResolvedValue(true)
    insert = vi.fn().mockReturnThis()
    mockFrom.mockReturnValue({
      insert,
      select: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: { ...fakeAlert, ...insert.mock.calls[0][0] }, error: null })),
    })
  })
  const today = { ticker: 'AAPL', type: 'price', operator: 'crosses_above', value: 195, name: 'AAPL cruza por encima de 195,00' }
  const post = async (body: unknown) => {
    const { POST } = await import('../route')
    const res = await POST(makePostRequest(body))
    return { status: res.status, body: await res.json() }
  }

  it("stores today's body exactly as before: the price against its value, nothing else written", async () => {
    const { status, body } = await post(today)

    expect(status).toBe(201)
    expect(insert).toHaveBeenCalledWith({ user_id: 'user-1', ...today })
    expect(body.alert).toMatchObject(today)
    expect(mockRateLimit).toHaveBeenCalledWith('rl:price-alerts:user-1', 30, 60)
  })

  it('the price crossing a value either way, with a color', async () => {
    const { status, body } = await post({ ...today, operator: 'crosses', color: '#f23645' })

    expect(status).toBe(201)
    expect(insert).toHaveBeenCalledWith({ user_id: 'user-1', ...today, operator: 'crosses', color: '#f23645' })
    expect(body.alert).toMatchObject({ operator: 'crosses', color: '#f23645' })
  })

  it('the price crossing EMA 50: no value, the timeframe and the period of its creation', async () => {
    const { status, body } = await post({ ...today, operator: 'crosses', value: null, source: 'price', target: 'ema50.ema50', timeframe: '1d', periods: { ema50: 50 } })

    expect(status).toBe(201)
    expect(insert).toHaveBeenCalledWith({ user_id: 'user-1', ...today, operator: 'crosses', value: null, target: 'ema50.ema50', timeframe: '1d', periods: { ema50: 50 } })
    expect(body.alert).toMatchObject({ target: 'ema50.ema50', timeframe: '1d', periods: { ema50: 50 }, value: null })
  })

  it('RSI 14 crossing 70 up on 1h', async () => {
    const { status } = await post({ ...today, value: 70, source: 'rsi.rsi', target: 'value', timeframe: '1h', periods: { rsi: 14 } })

    expect(status).toBe(201)
    expect(insert).toHaveBeenCalledWith({ user_id: 'user-1', ...today, value: 70, source: 'rsi.rsi', timeframe: '1h', periods: { rsi: 14 } })
  })

  it('EMA 20 crossing EMA 50 keeps both periods; a value sent with it is dropped', async () => {
    const { status } = await post({ ...today, operator: 'crosses_below', value: 12, source: 'ema20.ema20', target: 'ema50.ema50', timeframe: '4h', periods: { ema20: 21, ema50: 55 } })

    expect(status).toBe(201)
    expect(insert).toHaveBeenCalledWith({ user_id: 'user-1', ...today, operator: 'crosses_below', value: null, source: 'ema20.ema20', target: 'ema50.ema50', timeframe: '4h', periods: { ema20: 21, ema50: 55 } })
  })

  it.each([
    ['an unknown line', { source: 'rsi.signal', timeframe: '1d', periods: { rsi: 14 } }, 'Elegí qué tiene que cruzar: el precio o una línea de un indicador'],
    ['a histogram', { source: 'macd.histogram', timeframe: '1d', periods: {} }, 'Elegí qué tiene que cruzar: el precio o una línea de un indicador'],
    ['an unknown target line', { target: 'sma50.sma50', value: null }, 'Elegí contra qué: un valor o otra línea'],
    ['a bad crossing', { operator: 'crosses_up' }, 'Elegí cómo tiene que cruzar: para arriba, para abajo o cualquiera'],
    ['a bad color', { color: 'red' }, 'Elegí un color de la paleta'],
    ['a short color', { color: '#f00' }, 'Elegí un color de la paleta'],
    ['no value against a value', { value: null }, 'Completá el ticker, el tipo, la condición, el valor y el nombre de la alerta'],
    ['a line against itself', { source: 'ema50.ema50', target: 'ema50.ema50', value: null, timeframe: '1d', periods: { ema50: 50 } }, 'Elegí otra línea: una línea no se cruza a sí misma'],
    ['an indicator without its timeframe', { source: 'rsi.rsi', value: 70, periods: { rsi: 14 } }, 'Elegí uno de los intervalos del gráfico'],
    ['a timeframe the chart does not offer', { source: 'rsi.rsi', value: 70, timeframe: '2h', periods: { rsi: 14 } }, 'Elegí uno de los intervalos del gráfico'],
    ['an indicator without its periods', { source: 'rsi.rsi', value: 70, timeframe: '1h' }, 'Los períodos del indicador no son válidos'],
    ['a period out of bounds', { source: 'rsi.rsi', value: 70, timeframe: '1h', periods: { rsi: 1 } }, 'Los períodos del indicador no son válidos'],
    ["another indicator's period", { source: 'rsi.rsi', value: 70, timeframe: '1h', periods: { rsi: 14, ema50: 50 } }, 'Los períodos del indicador no son válidos'],
    ['a name too long', { name: 'x'.repeat(201) }, 'El nombre de la alerta tiene que tener entre 1 y 200 caracteres'],
  ])('refuses %s, writing nothing', async (_what, change, message) => {
    const { status, body } = await post({ ...today, ...change })

    expect(status).toBe(400)
    expect(body.error).toBe(message)
    expect(insert).not.toHaveBeenCalled()
  })

  it('refuses a "__proto__" among the periods', async () => {
    const { POST } = await import('../route')
    const raw = '{"ticker":"AAPL","type":"price","operator":"crosses","value":70,"name":"n","source":"rsi.rsi","timeframe":"1h","periods":{"rsi":14,"__proto__":{"x":1}}}'
    const res = await POST(new NextRequest('http://localhost/api/price-alerts', { method: 'POST', body: raw }))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Los períodos del indicador no son válidos')
    expect(insert).not.toHaveBeenCalled()
  })

  it('refuses a body over 4 KB', async () => {
    const { status, body } = await post({ ...today, padding: 'x'.repeat(5000) })

    expect(status).toBe(400)
    expect(body.error).toBe('La alerta es demasiado grande para guardarla.')
    expect(insert).not.toHaveBeenCalled()
  })

  it('answers 429 past the limit, writing nothing', async () => {
    mockRateLimit.mockResolvedValueOnce(false)

    const { status } = await post(today)

    expect(status).toBe(429)
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('GET /api/price-alerts returns the conditions', () => {
  it('as stored, the new fields included', async () => {
    mockRequireUser.mockResolvedValue({ user: fakeUser, supabase: mockSupabase })
    mockIsAuthFailure.mockReturnValue(false)
    const row = { ...fakeAlert, source: 'rsi.rsi', target: 'value', value: 70, timeframe: '1h', periods: { rsi: 14 }, color: '#089981', status: 'unavailable' }
    mockFrom.mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: [row], error: null }) })

    const { GET } = await import('../route')
    const res = await GET(makeGetRequest('?ticker=AAPL'))

    expect(await res.json()).toEqual({ alerts: [row] })
  })
})
