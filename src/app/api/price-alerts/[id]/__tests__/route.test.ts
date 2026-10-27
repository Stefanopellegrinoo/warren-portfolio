import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock auth ─────────────────────────────────────────────────────────────────
const mockRequireUser = vi.fn()
const mockIsAuthFailure = vi.fn()
vi.mock('@/lib/api-auth', () => ({
  requireUser: mockRequireUser,
  isAuthFailure: mockIsAuthFailure,
}))

// ── Mock redis ────────────────────────────────────────────────────────────────
const mockInvalidateUserCache = vi.fn()
const mockBumpAlerts = vi.fn()
vi.mock('@/lib/redis', () => ({
  invalidateUserCache: mockInvalidateUserCache,
  bumpAlertsVersion: () => mockBumpAlerts(),
}))

// ── Rate limit: allowed unless a test says otherwise ──────────────────────────
const mockRateLimit = vi.fn(async () => true)
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit: (...a: unknown[]) => mockRateLimit(...(a as [])),
}))

// ── Supabase mock ─────────────────────────────────────────────────────────────
const mockFrom = vi.fn()
const mockSupabase = { from: mockFrom }

const fakeUser = { id: 'user-1' }
const ALERT_ID = 'alert-abc-123'

function makeDeleteRequest(id: string) {
  return new NextRequest(`http://localhost/api/price-alerts/${id}`, {
    method: 'DELETE',
  })
}

function makePatchRequest(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/price-alerts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const fakeAlert = { id: ALERT_ID }

// ── DELETE tests ──────────────────────────────────────────────────────────────

describe('DELETE /api/price-alerts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: fakeUser, supabase: mockSupabase })
    mockIsAuthFailure.mockReturnValue(false)
  })

  it('returns 401 when not authenticated', async () => {
    mockRequireUser.mockResolvedValue({ error: new Response(null, { status: 401 }) })
    mockIsAuthFailure.mockReturnValue(true)

    const { DELETE } = await import('../route')
    const res = await DELETE(makeDeleteRequest(ALERT_ID), { params: { id: ALERT_ID } })
    expect(res.status).toBe(401)
  })

  it('returns 403 when alert does not belong to the user', async () => {
    // Simulate no row found (fetchError or no existing row)
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'No rows' } }),
    })

    const { DELETE } = await import('../route')
    const res = await DELETE(makeDeleteRequest(ALERT_ID), { params: { id: ALERT_ID } })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('returns 403 when alert exists but belongs to another user', async () => {
    // Ownership check returns null (no matching row for this user)
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })

    const { DELETE } = await import('../route')
    const res = await DELETE(makeDeleteRequest(ALERT_ID), { params: { id: ALERT_ID } })
    expect(res.status).toBe(403)
  })

  it('returns 204 when alert is successfully deleted', async () => {
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // Ownership check
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: fakeAlert, error: null }),
        }
      } else {
        // Delete succeeds
        const inner = {
          eq: vi.fn().mockResolvedValue({ error: null }),
        }
        return {
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnValue(inner),
        }
      }
    })

    const { DELETE } = await import('../route')
    const res = await DELETE(makeDeleteRequest(ALERT_ID), { params: { id: ALERT_ID } })
    // Route uses 204 No Content for successful deletion
    expect(res.status).toBe(204)
    // The worker reads the active alerts again (odd/tasks/supabase-efficiency.md S4)
    expect(mockBumpAlerts).toHaveBeenCalledTimes(1)
  })

  it('returns 500 when Supabase delete fails', async () => {
    // Track call count to differentiate ownership check from delete call
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // Ownership check: returns the alert
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: fakeAlert, error: null }),
        }
        return chain
      } else {
        // Delete: returns an error
        const inner = {
          eq: vi.fn().mockResolvedValue({ error: { message: 'DB error' } }),
        }
        const chain = {
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnValue(inner),
        }
        return chain
      }
    })

    const { DELETE } = await import('../route')
    const res = await DELETE(makeDeleteRequest(ALERT_ID), { params: { id: ALERT_ID } })
    expect(res.status).toBe(500)
  })
})

// ── PATCH tests ───────────────────────────────────────────────────────────────

describe('PATCH /api/price-alerts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: fakeUser, supabase: mockSupabase })
    mockIsAuthFailure.mockReturnValue(false)
    mockInvalidateUserCache.mockResolvedValue(undefined)
  })

  function makeChain(result: { data: unknown; error: unknown }) {
    const single = vi.fn().mockResolvedValue(result)
    const filters: [string, unknown][] = []
    const query: { eq: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn> } = {
      eq: vi.fn((column: string, value: unknown) => { filters.push([column, value]); return query }),
      select: vi.fn().mockReturnValue({ single }),
    }
    const update = vi.fn().mockReturnValue(query)
    return { from: vi.fn().mockReturnValue({ update }), filters }
  }

  it("an old client's drag (a value alone) only reaches an alert on the price against a value", async () => {
    const chain = makeChain({ data: null, error: { code: 'PGRST116', message: 'no rows' } })
    mockFrom.mockImplementation(chain.from)

    const { PATCH } = await import('../route')
    const res = await PATCH(makePatchRequest(ALERT_ID, { value: 72.3, operator: 'crosses_above', name: 'FXI cruza por encima de 72,30' }), { params: { id: ALERT_ID } })

    expect(chain.filters).toEqual(expect.arrayContaining([['source', 'price'], ['target', 'value']]))
    expect(res.status).toBe(404)
  })

  it('a whole condition from the sheet is not limited to price alerts', async () => {
    const chain = makeChain({ data: { id: ALERT_ID }, error: null })
    mockFrom.mockImplementation(chain.from)

    const { PATCH } = await import('../route')
    const res = await PATCH(makePatchRequest(ALERT_ID, { source: 'rsi.rsi', target: 'value', operator: 'crosses_above', value: 72, timeframe: '1h', periods: { rsi: 14 } }), { params: { id: ALERT_ID } })

    expect(res.status).toBe(200)
    expect(chain.filters).toEqual([['id', ALERT_ID], ['user_id', 'user-1']])
  })

  it('returns 200 with updated alert on partial update (value only)', async () => {
    const updatedAlert = { id: ALERT_ID, value: 150.5, operator: 'crosses_above' }
    const chain = makeChain({ data: updatedAlert, error: null })
    mockFrom.mockImplementation(chain.from)

    const { PATCH } = await import('../route')
    const res = await PATCH(makePatchRequest(ALERT_ID, { value: 150.5 }), { params: { id: ALERT_ID } })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.alert).toEqual(updatedAlert)
    expect(mockBumpAlerts).toHaveBeenCalledTimes(1)
  })

  it('returns 200 with updated alert on full update (all fields)', async () => {
    const updatedAlert = {
      id: ALERT_ID,
      name: 'My Alert',
      operator: 'crosses_below',
      value: 200,
      channel: 'email',
    }
    const chain = makeChain({ data: updatedAlert, error: null })
    mockFrom.mockImplementation(chain.from)

    const { PATCH } = await import('../route')
    const res = await PATCH(
      makePatchRequest(ALERT_ID, { name: 'My Alert', operator: 'crosses_below', value: 200, channel: 'email' }),
      { params: { id: ALERT_ID } }
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.alert).toEqual(updatedAlert)
  })

  it('returns 404 when alert belongs to a different user', async () => {
    const chain = makeChain({ data: null, error: { message: 'No rows found' } })
    mockFrom.mockImplementation(chain.from)

    const { PATCH } = await import('../route')
    const res = await PATCH(makePatchRequest(ALERT_ID, { value: 100 }), { params: { id: ALERT_ID } })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('re-arms a triggered alert: status active clears triggered_at, with the moved value and operator', async () => {
    const rearmed = { id: ALERT_ID, status: 'active', triggered_at: null, value: 210, operator: 'crosses_below' }
    const chain = makeChain({ data: rearmed, error: null })
    mockFrom.mockImplementation(chain.from)

    const { PATCH } = await import('../route')
    const res = await PATCH(
      makePatchRequest(ALERT_ID, { status: 'active', value: 210, operator: 'crosses_below' }),
      { params: { id: ALERT_ID } }
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ alert: rearmed })
    const update = chain.from.mock.results[0].value.update
    expect(update).toHaveBeenCalledWith({ status: 'active', triggered_at: null, value: 210, operator: 'crosses_below' })
    const eqAlertId = update.mock.results[0].value.eq
    expect(eqAlertId).toHaveBeenCalledWith('id', ALERT_ID)
    expect(eqAlertId.mock.results[0].value.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(mockInvalidateUserCache).toHaveBeenCalledWith('user-1')
  })

  it('returns 400 when status is anything other than active', async () => {
    const chain = makeChain({ data: null, error: null })
    mockFrom.mockImplementation(chain.from)

    const { PATCH } = await import('../route')
    const res = await PATCH(makePatchRequest(ALERT_ID, { status: 'triggered' }), { params: { id: ALERT_ID } })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Solo se puede reactivar la alerta')
    expect(chain.from).not.toHaveBeenCalled()
  })

  it('updates only the given fields when status is not sent', async () => {
    const chain = makeChain({ data: { id: ALERT_ID, name: 'Renamed' }, error: null })
    mockFrom.mockImplementation(chain.from)

    const { PATCH } = await import('../route')
    const res = await PATCH(makePatchRequest(ALERT_ID, { name: 'Renamed' }), { params: { id: ALERT_ID } })

    expect(res.status).toBe(200)
    expect(chain.from.mock.results[0].value.update).toHaveBeenCalledWith({ name: 'Renamed' })
  })

  it('returns 400 when operator is invalid', async () => {
    const { PATCH } = await import('../route')
    const res = await PATCH(
      makePatchRequest(ALERT_ID, { operator: 'invalid_op' }),
      { params: { id: ALERT_ID } }
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Elegí cómo tiene que cruzar: para arriba, para abajo o cualquiera')
  })
})

// odd/tasks/chart-customization.md S6: the alert sheet edits the price by hand, the color and the crossing,
// and replaces a condition whole; today's partial changes (move, rearm) still change just their columns.
describe('PATCH /api/price-alerts/[id] conditions', () => {
  let chain: { from: ReturnType<typeof vi.fn<(...a: unknown[]) => { update: ReturnType<typeof vi.fn> }>> }
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: fakeUser, supabase: mockSupabase })
    mockIsAuthFailure.mockReturnValue(false)
    mockInvalidateUserCache.mockResolvedValue(undefined)
    mockRateLimit.mockResolvedValue(true)
    const single = vi.fn(async () => ({ data: { id: ALERT_ID, ...update.mock.calls[0][0] }, error: null }))
    const query: { eq: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn> } = { eq: vi.fn(() => query), select: vi.fn().mockReturnValue({ single }) }
    const update = vi.fn().mockReturnValue(query)
    chain = { from: vi.fn().mockReturnValue({ update }) }
    mockFrom.mockImplementation((...a: unknown[]) => chain.from(...a))
  })
  const updated = () => chain.from.mock.results[0]?.value.update.mock.calls[0]?.[0]
  const patch = async (body: unknown) => {
    const { PATCH } = await import('../route')
    const res = await PATCH(makePatchRequest(ALERT_ID, body), { params: { id: ALERT_ID } })
    return { status: res.status, body: await res.json() }
  }
  const priceValue = { source: 'price', target: 'value', operator: 'crosses_above', value: 33.1, timeframe: null, periods: null }

  it('the price typed by hand, with its color and crossing: the whole condition is written', async () => {
    const { status, body } = await patch({ ...priceValue, color: '#f23645', name: 'FXI cruza por encima de 33,10' })

    expect(status).toBe(200)
    expect(updated()).toEqual({ ...priceValue, color: '#f23645', name: 'FXI cruza por encima de 33,10' })
    expect(body.alert).toMatchObject({ value: 33.1, color: '#f23645' })
    expect(mockRateLimit).toHaveBeenCalledWith('rl:price-alerts:user-1', 30, 60)
  })

  it('a color alone changes only the color', async () => {
    const { status } = await patch({ color: '#089981' })

    expect(status).toBe(200)
    expect(updated()).toEqual({ color: '#089981' })
  })

  it('back to the default color', async () => {
    await patch({ color: null })

    expect(updated()).toEqual({ color: null })
  })

  it('the crossing alone: either way', async () => {
    const { status } = await patch({ operator: 'crosses' })

    expect(status).toBe(200)
    expect(updated()).toEqual({ operator: 'crosses' })
  })

  it('a value alert becomes "price crosses EMA 50": the value is cleared, timeframe and period written', async () => {
    const { status } = await patch({ source: 'price', target: 'ema50.ema50', operator: 'crosses', value: 33.1, timeframe: '1d', periods: { ema50: 50 }, name: 'n' })

    expect(status).toBe(200)
    expect(updated()).toEqual({ source: 'price', target: 'ema50.ema50', operator: 'crosses', value: null, timeframe: '1d', periods: { ema50: 50 }, name: 'n' })
  })

  it("today's move still writes just value, operator and name", async () => {
    await patch({ value: 31, operator: 'crosses_below', name: 'FXI cruza por debajo de 31,00' })

    expect(updated()).toEqual({ value: 31, operator: 'crosses_below', name: 'FXI cruza por debajo de 31,00' })
  })

  it.each([
    ['a bad color', { color: 'blue' }, 'Elegí un color de la paleta'],
    ['a bad crossing', { operator: 'either' }, 'Elegí cómo tiene que cruzar: para arriba, para abajo o cualquiera'],
    ['a condition sent in part', { source: 'rsi.rsi', value: 70 }, 'Revisá la condición de la alerta y probá de nuevo.'],
    ['an unknown line', { ...priceValue, target: 'sma50.sma50' }, 'Elegí contra qué: un valor o otra línea'],
    ['no value against a value', { ...priceValue, value: null }, 'Completá el ticker, el tipo, la condición, el valor y el nombre de la alerta'],
    ['a value that is not a number', { value: '33' }, 'El valor de la alerta tiene que ser un número'],
    ['a null value with no condition', { value: null }, 'El valor de la alerta tiene que ser un número'],
  ])('refuses %s, writing nothing', async (_what, body, message) => {
    const res = await patch(body)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe(message)
    expect(chain.from).not.toHaveBeenCalled()
  })

  it('a condition the database refuses answers 400, not "not found"', async () => {
    const single = vi.fn(async () => ({ data: null, error: { code: '23514', message: 'violates check constraint "price_alerts_value_check"' } }))
    const query: Record<string, unknown> = { eq: () => query, select: () => ({ single }) }
    mockFrom.mockReturnValue({ update: () => query })

    const res = await patch({ ...priceValue, target: 'ema50.ema50', value: null, timeframe: '1d', periods: { ema50: 50 } })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Esa condición no es válida para esta alerta.')
  })

  it('answers 429 past the limit, writing nothing', async () => {
    mockRateLimit.mockResolvedValueOnce(false)

    const res = await patch({ color: '#089981' })

    expect(res.status).toBe(429)
    expect(chain.from).not.toHaveBeenCalled()
  })
})
