// T2 (S3, S7, odd/tasks/market-page.md): the Mercado board's pure rules.
import { describe, it, expect, vi } from 'vitest'

vi.mock('./supabase-server', () => ({ createServiceClient: vi.fn(), createServerClientInstance: vi.fn() }))

const { PANEL_LIDER, cedearPesoLines, buildMarketBoard } = await import('./market-board')
const { fetchLocalFeed, LOCAL_FEEDS } = await import('./data912-client')

const row = (symbol: string, c: number, pct_change: number) => ({ symbol, c, pct_change })
const NO_NAMES = { locals: {}, cedears: {} }
const FX = { mep: 1000, ccl: 1050 }
const AT = '2026-10-28T17:00:00.000Z'

describe('PANEL_LIDER', () => {
  it('is BYMA\'s 20 leading shares, as read on 2026-10-31', () => {
    expect(PANEL_LIDER).toEqual([
      'ALUA', 'BBAR', 'BMA', 'BYMA', 'CEPU', 'CRES', 'ECOG', 'EDN', 'GFVA', 'GGAL',
      'LOMA', 'METR', 'PAMP', 'SUPV', 'TGNO4', 'TGSU2', 'TRAN', 'TXAR', 'VALO', 'YPFD',
    ])
  })
})

describe('cedearPesoLines', () => {
  it('keeps a symbol whose D or C companion is in the feed, and drops the companions', () => {
    expect(cedearPesoLines(['AMD', 'AMDD', 'AMDC'], new Set())).toEqual(['AMD'])
    expect(cedearPesoLines(['XYZ', 'XYZC'], new Set())).toEqual(['XYZ'])
  })

  it('keeps a CEDEAR of the app\'s table even when the feed has no companion for it', () => {
    expect(cedearPesoLines(['KO'], new Set(['KO']))).toEqual(['KO'])
  })

  it('keeps a real ticker ending in D when its base is not in the feed', () => {
    expect(cedearPesoLines(['GILD', 'GILDD'], new Set(['GILD']))).toEqual(['GILD'])
  })

  it('drops a symbol that is neither in the table nor has a companion', () => {
    expect(cedearPesoLines(['QQQ', 'ZZZ'], new Set(['QQQ']))).toEqual(['QQQ'])
  })

  it('never lists a D/C line as its own row, even when the table knows that ticker', () => {
    expect(cedearPesoLines(['BA', 'BAD', 'BAC'], new Set(['BA', 'BAC']))).toEqual(['BA'])
  })
})

describe('buildMarketBoard', () => {
  it('lists the Panel líder in its fixed order, with null price and change for a member missing from the feed', () => {
    const stocks = PANEL_LIDER.filter(s => s !== 'GFVA').reverse().map(s => row(s, 1000, 1))

    const board = buildMarketBoard({ stocks, cedears: [row('AMD', 1, 0), row('AMDD', 1, 0)], names: NO_NAMES, fx: FX, updatedAt: AT })

    expect(board.lider.map(r => r.symbol)).toEqual([...PANEL_LIDER])
    expect(board.lider.find(r => r.symbol === 'GFVA')).toEqual({ symbol: 'GFVA', name: null, price: null, changePct: null })
  })

  it('turns data912\'s percent into a FRACTION and keeps the peso price', () => {
    const board = buildMarketBoard({
      stocks: [row('GGAL', 6500, 3.4), row('BMA', 9000, -1.25)],
      cedears: [row('AMD', 21000, 0.5), row('AMDD', 15, 0.4)],
      names: NO_NAMES, fx: FX, updatedAt: AT,
    })

    expect(board.lider.find(r => r.symbol === 'GGAL')).toMatchObject({ price: 6500 })
    expect(board.lider.find(r => r.symbol === 'GGAL')!.changePct).toBeCloseTo(0.034, 12)
    expect(board.lider.find(r => r.symbol === 'BMA')!.changePct).toBeCloseTo(-0.0125, 12)
    expect(board.cedears).toHaveLength(1)
    expect(board.cedears[0]).toMatchObject({ symbol: 'AMD', price: 21000 })
    expect(board.cedears[0].changePct).toBeCloseTo(0.005, 12)
  })

  it('gives a line with no price neither price nor change', () => {
    const board = buildMarketBoard({ stocks: [row('HARG', 0, 0)], cedears: [row('KO', 1, 0)], names: { locals: {}, cedears: { KO: null } }, fx: FX, updatedAt: AT })

    expect(board.locals).toEqual([{ symbol: 'HARG', name: null, price: null, changePct: null }])
  })

  it('keeps every local row as-is and names locals and CEDEARs from the catalogs', () => {
    const board = buildMarketBoard({
      stocks: [row('GGAL', 6500, 1), row('HARG', 1200, 0), row('GGALD', 4.5, 1)],
      cedears: [row('KO', 18000, 0), row('MELI', 25000, 2), row('MELID', 17, 2)],
      names: { locals: { GGAL: 'Grupo Galicia' }, cedears: { KO: 'Coca-Cola', MELI: null } },
      fx: FX, updatedAt: AT,
    })

    expect(board.locals.map(r => [r.symbol, r.name])).toEqual([['GGAL', 'Grupo Galicia'], ['HARG', null], ['GGALD', null]])
    expect(board.cedears.map(r => [r.symbol, r.name])).toEqual([['KO', 'Coca-Cola'], ['MELI', null]])
    expect(board.fx).toEqual(FX)
    expect(board.updatedAt).toBe(AT)
  })
})

describe('fetchLocalFeed (exported for the board, behavior unchanged)', () => {
  it('reads one feed with one GET and a timeout, and throws on a failed answer', async () => {
    const ok = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => [row('GGAL', 1, 0)] }) as unknown as Response)
    const down = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: false, status: 502, json: async () => [] }) as unknown as Response)

    expect(await fetchLocalFeed(LOCAL_FEEDS.stocks, ok as unknown as typeof fetch)).toEqual([row('GGAL', 1, 0)])
    expect(ok).toHaveBeenCalledTimes(1)
    expect(ok.mock.calls[0]).toEqual(['https://data912.com/live/arg_stocks', expect.objectContaining({ signal: expect.any(AbortSignal) })])
    await expect(fetchLocalFeed(LOCAL_FEEDS.cedears, down as unknown as typeof fetch)).rejects.toThrow('HTTP 502')
  })
})
