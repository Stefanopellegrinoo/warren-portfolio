import { describe, it, expect, vi } from 'vitest'
import oracle from './__fixtures__/byma-oracle.json'
import { ingestOnTerms, toRpcArgs, fetchBymaHtml } from './on-terms-ingest'
import { parseBymaPayload } from './byma-educa'

type Row = Record<string, unknown>
const rows: Row[] = (oracle.rows as Row[]).map((r, i) => ({ ...r, seg: 'hd', em: 'E', de: `C${i}`, mp: 'MEP', mto: 1, adtvp: [1, 2, 3], adtve: [r.tk, `${r.tk}D`, `${r.tk}C`] }))
const sov = ['A', 'B', 'C', 'D', 'E'].map((t, i) => ({ tk: `S${t}`, seg: 'sob', ley: 'NY', me: 'USD', isin: `ARARGE3209S${i}`, px: 1, ytm: 9, dm: 1 + i }))
const payload = (r = rows, tp: unknown = { rows: sov }) => ({ on: { fecha: '2026-10-20', fecha_liq: '2026-10-21', rows: r }, tp })
const html = (p: unknown) => `<script id="payload" type="application/json">${JSON.stringify(p)}</script>`

// Minimal supabase stub: records the rpc call, serves overrides and latest as_of.
function stub(opts: { latest?: string | null; rpcError?: string | null } = {}) {
  const rpc = vi.fn().mockResolvedValue({ error: opts.rpcError ? { message: opts.rpcError } : null })
  const from = vi.fn((table: string) => {
    if (table === 'on_terms_overrides') return { select: () => Promise.resolve({ data: [{ isin: 'AR0394353335', field: 'day_count', value: 'ACT/365', source_url: 'https://x', verified_at: '2026-10-21' }], error: null }) }
    return { select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: opts.latest ? [{ as_of: opts.latest }] : [], error: null }) }) }) }
  })
  return { client: { rpc, from } as never, rpc }
}

describe('toRpcArgs', () => {
  it('builds snake_case arrays the RPC expects', () => {
    const res = parseBymaPayload(payload())
    const a = toRpcArgs(res, [])
    expect(a.p_as_of).toBe('2026-10-20')
    expect(a.p_source).toBe('byma_educa')
    expect(a.p_terms).toHaveLength(228)
    expect(a.p_terms[0]).toMatchObject({ isin: expect.any(String), ticker_o: expect.any(String), law: expect.any(String), residual_pct: expect.any(Number), accrual_start: expect.any(String) })
    expect(a.p_flows.length).toBeGreaterThan(228)
    expect(a.p_flows[0]).toEqual({ isin: expect.any(String), flow_date: expect.any(String), ren: expect.any(Number), amo: expect.any(Number) })
    expect(a.p_sov).toHaveLength(5)
  })
  it('p_sov is null when the curve is missing so the last-good one is kept', () => {
    expect(toRpcArgs(parseBymaPayload({ on: payload().on }), []).p_sov).toBeNull()
  })
})

describe('ingestOnTerms', () => {
  it('fetches, checks, and replaces through the single RPC', async () => {
    const { client, rpc } = stub()
    const s = await ingestOnTerms(client, { fetchHtml: async () => html(payload()) })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][0]).toBe('replace_on_terms')
    const args = rpc.mock.calls[0][1]
    expect(args.p_checks.length).toBeGreaterThan(150)
    expect(s).toMatchObject({ asOf: '2026-10-20', ons: 228, skipped: 0 })
    expect(s.flagged).toBeGreaterThanOrEqual(0)
  })

  it('keeps last-good: a failing fetch never reaches the RPC', async () => {
    const { client, rpc } = stub()
    await expect(ingestOnTerms(client, { fetchHtml: async () => { throw new Error('boom') } })).rejects.toThrow('boom')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('keeps last-good: a broken payload never reaches the RPC', async () => {
    const { client, rpc } = stub()
    await expect(ingestOnTerms(client, { fetchHtml: async () => '<html>maintenance</html>' })).rejects.toThrow(/payload/)
    await expect(ingestOnTerms(client, { fetchHtml: async () => html(payload(rows.slice(0, 50))) })).rejects.toThrow(/200/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses a payload older than what is stored', async () => {
    const { client, rpc } = stub({ latest: '2026-10-21' })
    await expect(ingestOnTerms(client, { fetchHtml: async () => html(payload()) })).rejects.toThrow(/older/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('accepts the same day again (idempotent re-run)', async () => {
    const { client, rpc } = stub({ latest: '2026-10-20' })
    await ingestOnTerms(client, { fetchHtml: async () => html(payload()) })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('throws when the RPC fails', async () => {
    const { client } = stub({ rpcError: 'p_terms must be an array' })
    await expect(ingestOnTerms(client, { fetchHtml: async () => html(payload()) })).rejects.toThrow(/p_terms must be/)
  })

  it('logs malformed-override warnings and skipped rows without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bad = [...rows]
    bad[0] = { ...bad[0], isin: 'bad' }
    const { client } = stub()
    const s = await ingestOnTerms(client, { fetchHtml: async () => html(payload(bad)) })
    expect(s.skipped).toBe(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('fetchBymaHtml', () => {
  it('throws on a non-2xx response', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status: 503 }))
    await expect(fetchBymaHtml()).rejects.toThrow(/503/)
    f.mockRestore()
  })
  it('returns the body on success, asking for the BYMA Educa dashboard', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html/>', { status: 200 }))
    expect(await fetchBymaHtml()).toBe('<html/>')
    expect(String(f.mock.calls[0][0])).toBe('https://tablero.bymaeduca.com.ar/')
    f.mockRestore()
  })
})
