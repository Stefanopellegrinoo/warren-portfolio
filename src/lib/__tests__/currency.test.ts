import { describe, it, expect, vi, beforeEach } from 'vitest'

const redis = { get: vi.fn(), setex: vi.fn(), set: vi.fn() }
let ready = true
vi.mock('../redis', () => ({ getRedis: () => redis, isRedisReady: () => ready }))

// fx_rates rows served in pages, like PostgREST does.
let fxRows: Array<{ date: string; kind: string; buy: number; sell: number }> = []
const ranges: Array<[number, number]> = []
vi.mock('../supabase-server', () => ({
  createServiceClient: () => ({
    from: () => {
      const q: any = { filters: {} as Record<string, string> }
      q.select = () => q
      q.eq = (_c: string, v: string) => { q.filters.kind = v; return q }
      q.gte = (_c: string, v: string) => { q.filters.from = v; return q }
      q.lte = (_c: string, v: string) => { q.filters.to = v; return q }
      q.lt = (_c: string, v: string) => { q.filters.before = v; return q }
      q.order = () => q
      q.range = async (a: number, b: number) => {
        ranges.push([a, b])
        const all = fxRows.filter(r => r.kind === q.filters.kind && r.date >= q.filters.from && r.date <= q.filters.to && r.date < q.filters.before)
        return { data: all.slice(a, b + 1), error: null }
      }
      return q
    },
  }),
}))

const fetchMock = vi.fn()
const { getDollarInfo, getCCLRate, getHistoricalCCL } = await import('../currency')

const dolarapi = (compra: number, venta: number) => ({
  ok: true, status: 200,
  json: async () => ({ casa: 'contadoconliqui', compra, venta, fechaActualizacion: '2026-10-22T20:59:00.000Z' }),
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  redis.get.mockResolvedValue(null)
  ready = true
  fxRows = []
  ranges.length = 0
})

describe('getDollarInfo', () => {
  it('live: mid of dolarapi buy/sell, stamped with its update time, cached one minute', async () => {
    fetchMock.mockResolvedValueOnce(dolarapi(1637.9, 1639.5))
    const r = await getDollarInfo('ccl')
    expect(r).toEqual({ rate: 1638.7, asOf: '2026-10-22T20:59:00.000Z', source: 'live' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://dolarapi.com/v1/dolares/contadoconliqui')
    const ttls = Object.fromEntries(redis.setex.mock.calls.map(c => [c[0], c[1]]))
    expect(ttls['currency:ccl']).toBe(60)
    expect(ttls['currency:ccl:lkp']).toBe(30 * 86400)
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('MEP reads the bolsa series', async () => {
    fetchMock.mockResolvedValueOnce(dolarapi(1546.9, 1553.6))
    expect((await getDollarInfo('mep'))!.rate).toBeCloseTo(1550.25)
    expect(fetchMock.mock.calls[0][0]).toBe('https://dolarapi.com/v1/dolares/bolsa')
  })

  it('cache hit: no fetch, keeps the original observation time', async () => {
    redis.get.mockResolvedValueOnce(JSON.stringify({ rate: 1600, asOf: '2026-10-22T20:00:00.000Z' }))
    expect(await getDollarInfo('ccl')).toEqual({ rate: 1600, asOf: '2026-10-22T20:00:00.000Z', source: 'cache' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('live down: last-known rate with its real age', async () => {
    redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(JSON.stringify({ rate: 1500, asOf: '2026-10-19T20:00:00.000Z' }))
    fetchMock.mockRejectedValueOnce(new Error('down'))
    expect(await getDollarInfo('ccl')).toEqual({ rate: 1500, asOf: '2026-10-19T20:00:00.000Z', source: 'lkp' })
  })

  it('nothing available: null, never an invented rate', async () => {
    ready = false
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
    expect(await getCCLRate()).toBeNull()
  })
})

describe('getHistoricalCCL', () => {
  it('reads fx_rates mid rates for the range, past the 1000-row page', async () => {
    fxRows = Array.from({ length: 1500 }, (_, i) => {
      const d = new Date(Date.UTC(2020, 0, 1) + i * 86400_000).toISOString().slice(0, 10)
      return { date: d, kind: 'ccl', buy: 100 + i, sell: 102 + i }
    })
    fxRows.push({ date: '2020-01-01', kind: 'mep', buy: 1, sell: 1 })
    const rates = await getHistoricalCCL(new Date('2020-01-01'), new Date('2030-01-01'))
    expect(rates.size).toBe(1500)
    expect(rates.get('2020-01-01')).toBe(101)
    expect(ranges.length).toBeGreaterThan(1)
  })

  it('leaves today out: today is the live rate, its fx_rates row is still moving', async () => {
    const { argentinaDate } = await import('../utils')
    fxRows = [{ date: '2026-01-02', kind: 'ccl', buy: 10, sell: 12 }, { date: argentinaDate(), kind: 'ccl', buy: 99, sell: 99 }]
    const rates = await getHistoricalCCL(new Date('2026-01-01'), new Date('2099-01-01'))
    expect([...rates.keys()]).toEqual(['2026-01-02'])
  })
})
