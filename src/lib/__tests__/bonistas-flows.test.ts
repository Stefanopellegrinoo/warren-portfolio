import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseBonistasPastFlows, backfillPastFlows } from '../bonistas-flows'

// Shape verified with a live GET of https://bonistas.com/bono-cotizacion-rendimiento-precio-hoy/MGCMO (2026-10-22)
const page = (bondData: unknown) =>
  `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { bondData } } })}</script></html>`

const CAC5 = {
  flow_past: [
    { fecha: '2025-02-25', cupon: 4.625, principal: 12.5, saldo: 100, total: 17.125 },
    { fecha: '2025-08-25', cupon: 4.0469, principal: 12.5, saldo: 87.5, total: 16.5469 },
  ],
  flow: [{ fecha: '2027-02-25', cupon: 2.3125, principal: 12.5, saldo: 50, total: 14.8125 }],
}

describe('parseBonistasPastFlows', () => {
  it('reads past coupon and amortization per 100 original VN, never the future rows', () => {
    expect(parseBonistasPastFlows(page(CAC5))).toEqual([
      { date: '2025-02-25', ren: 4.625, amo: 12.5 },
      { date: '2025-08-25', ren: 4.0469, amo: 12.5 },
    ])
  })

  it('a page without bond data (bond not covered): no flows', () => {
    expect(parseBonistasPastFlows('<html>home</html>')).toEqual([])
  })
})

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

function fakeSupabase() {
  const writes: Array<{ rows: any[]; opts: any }> = []
  return { writes, client: { from: () => ({ upsert: async (rows: any[], opts: any) => { writes.push({ rows, opts }); return { error: null } } }) } as any }
}

describe('backfillPastFlows', () => {
  it('stores past flows in on_flow_history marked as bonistas, never overwriting BYMA rows', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => page(CAC5) })
    const db = fakeSupabase()
    expect(await backfillPastFlows(db.client, 'ARCAC5', 'CAC5O', '2026-10-22')).toBe(2)
    expect(fetchMock.mock.calls[0][0]).toBe('https://bonistas.com/bono-cotizacion-rendimiento-precio-hoy/CAC5O')
    expect(db.writes[0].opts).toEqual({ onConflict: 'isin,flow_date', ignoreDuplicates: true })
    expect(db.writes[0].rows[0]).toEqual({
      isin: 'ARCAC5', flow_date: '2025-02-25', ren: 4.625, amo: 12.5,
      first_seen_as_of: '2026-10-22', last_seen_as_of: '2026-10-22', source: 'bonistas',
    })
  })

  it('a redirect to the home page (bond not covered) writes nothing', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, redirected: true, text: async () => '<html>home</html>' })
    const db = fakeSupabase()
    expect(await backfillPastFlows(db.client, 'ARLMS8', 'LMS8O', '2026-10-22')).toBe(0)
    expect(db.writes).toEqual([])
  })

  it('throws on an HTTP error so the caller can retry', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => '' })
    await expect(backfillPastFlows(fakeSupabase().client, 'X', 'XO', '2026-10-22')).rejects.toThrow(/bonistas 500/)
  })
})
