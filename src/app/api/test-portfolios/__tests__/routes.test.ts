import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { analyzeOn, type OnAnalysis } from '@/lib/on-analytics'

// ---- fakes: auth + catalog + a chainable Supabase client that records every call ----
const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({ requireUser: () => mockRequireUser(), isAuthFailure: (r: any) => 'error' in r }))
const mockLoad = vi.fn()
vi.mock('@/lib/on-catalog', () => ({ loadOnAnalyses: (...a: unknown[]) => mockLoad(...a) }))

type Result = { data?: any; error?: { code?: string; message?: string } | null }
// A function answers each read in turn (e.g. the item an edit reads, then the list its view reads).
let plan: Record<string, Result | (() => Result)> = {}
let calls: { table: string; op: string; method: string; args: unknown[] }[] = []
const WRITES = ['insert', 'update', 'delete']
const fakeSb = {
  from(table: string) {
    let op = 'select'
    const q: any = {}
    for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit']) {
      q[m] = (...args: unknown[]) => {
        if (WRITES.includes(m)) op = m
        calls.push({ table, op, method: m, args })
        return q
      }
    }
    const res = () => {
      const p = plan[`${table}.${op}`]
      return Promise.resolve({ data: null, error: null, ...((typeof p === 'function' ? p() : p) ?? {}) })
    }
    q.maybeSingle = q.single = () => res()
    q.then = (ok: any, ko: any) => res().then(ok, ko)
    return q
  },
}
const wrote = (table: string, op: string) => calls.find((c) => c.table === table && c.op === op && c.method === op)

const ID = '11111111-1111-4111-8111-111111111111'
const ITEM = '22222222-2222-4222-8222-222222222222'
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const mk = (isin: string, over: Record<string, unknown> = {}, price: number | null = 100, overrides: any[] = []): OnAnalysis =>
  analyzeOn({
    terms: { isin, tickerO: 'TSTO', tickerD: 'TSTD', tickerC: null, issuer: 'Emisor de Prueba S.A.', description: null, law: 'NY', currency: 'USD', paymentPlaza: 'CCL', est: 'Step Up', frequency: 'Semestral', issueDate: '2026-04-22', maturityDate: '2028-04-21', couponRate: 0.06, residualPct: 100, accrualStart: '2026-10-22', issuedAmountByma: null, adtvO: null, adtvD: null, adtvC: null, asOf: '2026-10-20', ...over } as any,
    flows: [{ date: '2027-04-22', ren: 3, amo: 0 }, { date: '2028-04-21', ren: 3, amo: 100 }],
    overrides, events: [], check: null, curve: [], price, settle: '2026-10-22',
  })
const GOOD = 'AR0000000001'
const catalog = (...a: OnAnalysis[]) => ({ analyses: a, asOf: '2026-10-20', stale: false, prices: { ok: true, quiet: false, fetchedAt: null } })

const json = (body: unknown, method = 'POST') => new Request('http://x/api', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const ctx = (id = ID, itemId = ITEM) => ({ params: { id, itemId } })

const list = await import('../route')
const one = await import('../[id]/route')
const items = await import('../[id]/items/route')
const item = await import('../[id]/items/[itemId]/route')

beforeEach(() => {
  plan = {}
  calls = []
  mockRequireUser.mockReset().mockResolvedValue({ supabase: fakeSb, user: { id: USER } })
  mockLoad.mockReset().mockResolvedValue(catalog(mk(GOOD)))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('auth: every handler needs a session and touches nothing without one', () => {
  it('401s', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })
    const rs = await Promise.all([
      list.GET(), list.POST(json({ name: 'x' })), one.GET(new Request('http://x'), ctx()), one.PATCH(json({ name: 'x' }, 'PATCH'), ctx()),
      one.DELETE(new Request('http://x'), ctx()), items.POST(json({}), ctx()), item.PATCH(json({}, 'PATCH'), ctx(ID, ITEM)), item.DELETE(new Request('http://x'), ctx(ID, ITEM)),
    ])
    expect(rs.map((r) => r.status)).toEqual(Array(8).fill(401))
    expect(calls).toHaveLength(0)
  })
})

describe('GET /api/test-portfolios', () => {
  it('lists the user portfolios with their item count', async () => {
    plan['test_portfolios.select'] = { data: [{ id: ID, name: 'A', created_at: 'c', updated_at: 'u', test_portfolio_items: [{ count: 3 }] }] }
    const res = await list.GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ portfolios: [{ id: ID, name: 'A', itemCount: 3, createdAt: 'c', updatedAt: 'u' }], limits: { portfolios: 20, items: 50 } })
  })
  it('DB failure is a generic 500 that does not leak the message', async () => {
    plan['test_portfolios.select'] = { error: { message: 'secret relation detail' } }
    const res = await list.GET()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })
})

describe('POST /api/test-portfolios', () => {
  it('creates with the SESSION user id, never one from the body', async () => {
    plan['test_portfolios.insert'] = { data: { id: ID, name: 'Mi prueba', created_at: 'c', updated_at: 'u' } }
    const res = await list.POST(json({ name: '  Mi prueba ' }))
    expect(res.status).toBe(201)
    expect(wrote('test_portfolios', 'insert')!.args[0]).toEqual({ user_id: USER, name: 'Mi prueba' })
  })
  it('rejects a smuggled user_id and an empty name before the database', async () => {
    expect((await list.POST(json({ name: 'x', user_id: 'other' }))).status).toBe(400)
    expect((await list.POST(json({ name: '  ' }))).status).toBe(400)
    expect((await list.POST(new Request('http://x', { method: 'POST', body: '{not json' }))).status).toBe(400)
    expect(calls).toHaveLength(0)
  })
  it('duplicate name -> 409; limit -> 409 with the limit message', async () => {
    plan['test_portfolios.insert'] = { error: { code: '23505', message: 'dup' } }
    const dup = await list.POST(json({ name: 'x' }))
    expect(dup.status).toBe(409)
    expect((await dup.json()).error).toMatch(/ya tenés una cartera/i)
    plan['test_portfolios.insert'] = { error: { code: '23514', message: 'test_portfolio_limit' } }
    const lim = await list.POST(json({ name: 'x' }))
    expect(lim.status).toBe(409)
    expect((await lim.json()).error).toMatch(/20 carteras/)
  })
})

describe('GET /api/test-portfolios/[id] (computed view)', () => {
  it('rejects a malformed id without touching the database', async () => {
    expect((await one.GET(new Request('http://x'), ctx("x'; drop"))).status).toBe(400)
    expect(calls).toHaveLength(0)
  })
  it('404 when RLS hides it or it does not exist', async () => {
    plan['test_portfolios.select'] = { data: null }
    expect((await one.GET(new Request('http://x'), ctx())).status).toBe(404)
  })
  it('returns the portfolio, its items and the computed analysis', async () => {
    plan['test_portfolios.select'] = { data: { id: ID, name: 'Mi prueba', created_at: 'c', updated_at: 'u' } }
    plan['test_portfolio_items.select'] = { data: [{ id: ITEM, isin: GOOD, input_mode: 'vn', amount: '10000.0000', manual_price: null, created_at: 'c' }] }
    const res = await one.GET(new Request('http://x'), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.portfolio.name).toBe('Mi prueba')
    expect(body.items).toEqual([{ id: ITEM, isin: GOOD, mode: 'vn', amount: 10000, manualPrice: null }])
    expect(body.analysis.empty).toBe(false)
    expect(body.analysis.totals.cost).toBeCloseTo(10_000, 6)
    expect(body.limits).toEqual({ portfolios: 20, items: 50 })
  })
  it('an empty portfolio is a valid empty view', async () => {
    plan['test_portfolios.select'] = { data: { id: ID, name: 'Vacía', created_at: 'c', updated_at: 'u' } }
    plan['test_portfolio_items.select'] = { data: [] }
    const body = await (await one.GET(new Request('http://x'), ctx())).json()
    expect(body.analysis.empty).toBe(true)
  })
  it('catalog failure is a generic 500', async () => {
    plan['test_portfolios.select'] = { data: { id: ID, name: 'x', created_at: 'c', updated_at: 'u' } }
    plan['test_portfolio_items.select'] = { data: [] }
    mockLoad.mockRejectedValue(new Error('boom detail'))
    const res = await one.GET(new Request('http://x'), ctx())
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('boom')
  })
})

describe('PATCH / DELETE /api/test-portfolios/[id]', () => {
  it('rename: 404 when no row matched (not yours), 409 duplicate, 200 ok', async () => {
    plan['test_portfolios.update'] = { data: null }
    expect((await one.PATCH(json({ name: 'n' }, 'PATCH'), ctx())).status).toBe(404)
    plan['test_portfolios.update'] = { error: { code: '23505' } }
    expect((await one.PATCH(json({ name: 'n' }, 'PATCH'), ctx())).status).toBe(409)
    plan['test_portfolios.update'] = { data: { id: ID, name: 'n', created_at: 'c', updated_at: 'u' } }
    const ok = await one.PATCH(json({ name: 'n' }, 'PATCH'), ctx())
    expect(ok.status).toBe(200)
    expect(wrote('test_portfolios', 'update')!.args[0]).toEqual({ name: 'n' })
  })
  it('delete: 404 when nothing was deleted, 204 otherwise', async () => {
    plan['test_portfolios.delete'] = { data: [] }
    expect((await one.DELETE(new Request('http://x'), ctx())).status).toBe(404)
    plan['test_portfolios.delete'] = { data: [{ id: ID }] }
    expect((await one.DELETE(new Request('http://x'), ctx())).status).toBe(204)
  })
})

describe('POST /api/test-portfolios/[id]/items', () => {
  const add = (b: unknown) => items.POST(json(b), ctx())
  const body = { isin: GOOD, mode: 'usd', amount: 1000 }

  it('adds a valid ON; the row carries the portfolio id and no user id', async () => {
    plan['test_portfolio_items.insert'] = { data: { id: ITEM, isin: GOOD, input_mode: 'usd', amount: 1000, manual_price: null } }
    const res = await add(body)
    expect(res.status).toBe(201)
    expect(wrote('test_portfolio_items', 'insert')!.args[0]).toEqual({ portfolio_id: ID, isin: GOOD, input_mode: 'usd', amount: 1000, manual_price: null })
  })
  it('floating ON is rejected with 422 and nothing is written (A7)', async () => {
    mockLoad.mockResolvedValue(catalog(mk(GOOD, { est: 'Tasa Variable' })))
    const res = await add(body)
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/tasa variable/i)
    expect(wrote('test_portfolio_items', 'insert')).toBeUndefined()
  })
  it('non-USD ON is rejected with 422 (A8)', async () => {
    mockLoad.mockResolvedValue(catalog(mk(GOOD, { currency: 'ARS' })))
    expect((await add(body)).status).toBe(422)
  })
  it('an amount below the minimum lot is rejected with the lot rule (R4.1)', async () => {
    mockLoad.mockResolvedValue(catalog(mk(GOOD, {}, 100, [{ isin: GOOD, field: 'min_denomination', value: 10_000, sourceUrl: 'https://example.org', verifiedAt: null }])))
    const res = await add({ isin: GOOD, mode: 'vn', amount: 500 })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/mínimo/i)
  })
  it('an ON without market price is accepted (it will be flagged in the view)', async () => {
    mockLoad.mockResolvedValue(catalog(mk(GOOD, {}, null)))
    plan['test_portfolio_items.insert'] = { data: { id: ITEM, isin: GOOD, input_mode: 'usd', amount: 1000, manual_price: null } }
    expect((await add(body)).status).toBe(201)
  })
  it('unknown ISIN -> 404; invalid body -> 400 before any lookup', async () => {
    mockLoad.mockResolvedValue(catalog()) // the real loader scopes by ISIN: nothing comes back
    expect((await add({ ...body, isin: 'AR0000000099' })).status).toBe(404)
    mockLoad.mockClear()
    expect((await add({ ...body, amount: -1 })).status).toBe(400)
    expect(mockLoad).not.toHaveBeenCalled()
  })
  it('duplicate ISIN -> 409, item limit -> 409, portfolio not yours (RLS) -> 404', async () => {
    plan['test_portfolio_items.insert'] = { error: { code: '23505' } }
    expect((await add(body)).status).toBe(409)
    plan['test_portfolio_items.insert'] = { error: { code: '23514', message: 'test_portfolio_item_limit' } }
    const lim = await add(body)
    expect(lim.status).toBe(409)
    expect((await lim.json()).error).toMatch(/50 ONs/)
    plan['test_portfolio_items.insert'] = { error: { code: '42501', message: 'row-level security' } }
    expect((await add(body)).status).toBe(404)
  })
})

describe('unknown keys and matured ONs', () => {
  it('unknown keys get a Spanish message', async () => {
    const res = await list.POST(json({ name: 'x', user_id: 'other' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/campos no permitidos/i)
  })
  it('a matured ON cannot be added or edited (clear message) but can be deleted', async () => {
    mockLoad.mockResolvedValue(catalog(mk(GOOD, { maturityDate: '2026-04-21' })))
    const old = analyzeOn({ terms: { isin: GOOD, tickerO: 'OLDO', tickerD: 'OLDD', tickerC: null, issuer: 'x', description: null, law: 'NY', currency: 'USD', paymentPlaza: 'CCL', est: 'Step Up', frequency: 'Semestral', issueDate: '2025-04-22', maturityDate: '2026-04-21', couponRate: 0.06, residualPct: 100, accrualStart: '2026-04-21', issuedAmountByma: null, adtvO: null, adtvD: null, adtvC: null, asOf: '2026-10-20' } as any, flows: [{ date: '2026-04-21', ren: 3, amo: 100 }], overrides: [], events: [], check: null, curve: [], price: 100, settle: '2026-10-22' })
    mockLoad.mockResolvedValue(catalog(old))
    const add = await items.POST(json({ isin: GOOD, mode: 'usd', amount: 1000 }), ctx())
    expect(add.status).toBe(422)
    expect((await add.json()).error).toMatch(/vencida/i)
    plan['test_portfolio_items.select'] = { data: { id: ITEM, isin: GOOD, input_mode: 'usd', amount: 1000, manual_price: null } }
    const edit = await item.PATCH(json({ amount: 5 }, 'PATCH'), ctx(ID, ITEM))
    expect(edit.status).toBe(422)
    plan['test_portfolio_items.delete'] = { data: [{ id: ITEM }] }
    expect((await item.DELETE(new Request('http://x'), ctx(ID, ITEM))).status).toBe(204)
  })
})

describe('PATCH / DELETE /api/test-portfolios/[id]/items/[itemId]', () => {
  const patch = (b: unknown) => item.PATCH(json(b, 'PATCH'), ctx(ID, ITEM))
  it('edits the amount after re-validating the merged item against the catalog', async () => {
    plan['test_portfolio_items.select'] = { data: { id: ITEM, isin: GOOD, input_mode: 'usd', amount: 1000, manual_price: null } }
    plan['test_portfolio_items.update'] = { data: { id: ITEM, isin: GOOD, input_mode: 'usd', amount: 2000, manual_price: null } }
    const res = await patch({ amount: 2000 })
    expect(res.status).toBe(200)
    expect(wrote('test_portfolio_items', 'update')!.args[0]).toEqual({ amount: 2000 })
  })
  it('404 when the item is not visible; 422 when the edit breaks a lot rule', async () => {
    plan['test_portfolio_items.select'] = { data: null }
    expect((await patch({ amount: 5 })).status).toBe(404)
    plan['test_portfolio_items.select'] = { data: { id: ITEM, isin: GOOD, input_mode: 'vn', amount: 10_000, manual_price: null } }
    mockLoad.mockResolvedValue(catalog(mk(GOOD, {}, 100, [{ isin: GOOD, field: 'min_denomination', value: 10_000, sourceUrl: 'https://example.org', verifiedAt: null }])))
    expect((await patch({ amount: 500 })).status).toBe(422)
  })
  it('manualPrice null clears the manual price', async () => {
    plan['test_portfolio_items.select'] = { data: { id: ITEM, isin: GOOD, input_mode: 'usd', amount: 1000, manual_price: 95 } }
    plan['test_portfolio_items.update'] = { data: { id: ITEM, isin: GOOD, input_mode: 'usd', amount: 1000, manual_price: null } }
    expect((await patch({ manualPrice: null })).status).toBe(200)
    expect(wrote('test_portfolio_items', 'update')!.args[0]).toEqual({ manual_price: null })
  })
  it('delete: 404 / 204; ids are validated', async () => {
    plan['test_portfolio_items.delete'] = { data: [] }
    expect((await item.DELETE(new Request('http://x'), ctx(ID, ITEM))).status).toBe(404)
    plan['test_portfolio_items.delete'] = { data: [{ id: ITEM }] }
    expect((await item.DELETE(new Request('http://x'), ctx(ID, ITEM))).status).toBe(204)
    expect((await item.DELETE(new Request('http://x'), ctx(ID, 'nope'))).status).toBe(400)
  })
})

describe('an edit answers with the updated view, so the page needs one round trip (odd/tasks/rendimiento.md S9)', () => {
  const PORTFOLIO = { id: ID, name: 'Mi prueba', created_at: 'c', updated_at: 'u' }
  const row = (amount: number) => ({ id: ITEM, isin: GOOD, input_mode: 'usd', amount, manual_price: null, created_at: 'c' })
  const reads = (...answers: Result[]) => () => answers.shift() ?? { data: null }

  it('PATCH of an item keeps `item` and adds the view GET would return', async () => {
    plan['test_portfolio_items.select'] = reads({ data: row(1000) }, { data: [row(2000)] })
    plan['test_portfolio_items.update'] = { data: row(2000) }
    plan['test_portfolios.select'] = { data: PORTFOLIO }
    const res = await item.PATCH(json({ amount: 2000 }, 'PATCH'), ctx(ID, ITEM))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.item).toEqual({ id: ITEM, isin: GOOD, mode: 'usd', amount: 2000, manualPrice: null })

    plan['test_portfolio_items.select'] = { data: [row(2000)] }
    const view = await (await one.GET(new Request('http://x'), ctx())).json()
    expect(body.view).toEqual(view)
    expect(body.view.items).toEqual([{ id: ITEM, isin: GOOD, mode: 'usd', amount: 2000, manualPrice: null }])
  })

  it('POST of an item keeps `item` (201) and adds the view', async () => {
    plan['test_portfolio_items.insert'] = { data: row(1000) }
    plan['test_portfolio_items.select'] = { data: [row(1000)] }
    plan['test_portfolios.select'] = { data: PORTFOLIO }
    const res = await items.POST(json({ isin: GOOD, mode: 'usd', amount: 1000 }), ctx())
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.item.id).toBe(ITEM)
    expect(body.view.portfolio).toEqual({ id: ID, name: 'Mi prueba', createdAt: 'c', updatedAt: 'u' })
    expect(body.view.analysis.totals.cost).toBeGreaterThan(0)
  })

  it('DELETE of an item answers with the view when asked (?view=1), and stays 204 otherwise', async () => {
    plan['test_portfolio_items.delete'] = { data: [{ id: ITEM }] }
    plan['test_portfolio_items.select'] = { data: [] }
    plan['test_portfolios.select'] = { data: PORTFOLIO }
    const res = await item.DELETE(new Request('http://x/api?view=1'), ctx(ID, ITEM))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.view.items).toEqual([])
    expect(body.view.analysis.empty).toBe(true)
    expect((await item.DELETE(new Request('http://x/api'), ctx(ID, ITEM))).status).toBe(204)
  })

  it('a saved edit whose view cannot be built still says it was saved, without the view', async () => {
    plan['test_portfolio_items.select'] = reads({ data: row(1000) }, { data: [row(2000)] })
    plan['test_portfolio_items.update'] = { data: row(2000) }
    plan['test_portfolios.select'] = { error: { message: 'down' } }
    const res = await item.PATCH(json({ amount: 2000 }, 'PATCH'), ctx(ID, ITEM))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.item.amount).toBe(2000)
    expect(body.view).toBeUndefined()
  })
})
