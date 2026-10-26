import { describe, it, expect, vi } from 'vitest'
import { ingestFxRates, getFxRate } from '../fx-rates'

const series = {
  bolsa: [
    { casa: 'bolsa', compra: 1540, venta: 1550, fecha: '2026-10-21' },
    { casa: 'bolsa', compra: 1547.8, venta: 1553.8, fecha: '2026-10-22' },
  ],
  contadoconliqui: [{ casa: 'contadoconliqui', compra: 1635.1, venta: 1638, fecha: '2026-10-22' }],
}

function fakeFetch(overrides: Partial<Record<keyof typeof series, unknown>> = {}) {
  return vi.fn(async (url: string | URL | Request) => {
    const kind = String(url).split('/').pop() as keyof typeof series
    const body = kind in overrides ? overrides[kind] : series[kind]
    return { ok: body !== undefined, status: body === undefined ? 500 : 200, json: async () => body } as Response
  })
}

type Stored = { date: string; kind: string; buy: number | string; sell: number | string }

/** fx_rates as stored (served in pages by `range`), and the upserts it receives. */
function fakeDb({ upsertError = null, stored = [] as Stored[], readError = null, maxRows = 1000 }: { upsertError?: unknown; stored?: Stored[]; readError?: unknown; maxRows?: number } = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: upsertError })
  const ranges: [number, number][] = []
  const select = vi.fn(() => {
    let from = 0
    let to = Infinity
    const b: any = {
      order: () => b,
      range: (f: number, t: number) => { from = f; to = t; ranges.push([f, t]); return b },
      // Like PostgREST, a page holds at most the server's row cap, whatever range was asked.
      then: (res: any, rej: any) => Promise.resolve(readError ? { data: null, error: readError } : { data: stored.slice(from, Math.min(to + 1, from + maxRows)), error: null }).then(res, rej),
    }
    return b
  })
  return { client: { from: vi.fn(() => ({ upsert, select })) }, upsert, select, ranges }
}

describe('ingestFxRates', () => {
  it('reads MEP and CCL history from argentinadatos and upserts every day by date and kind', async () => {
    const fetch = fakeFetch()
    const db = fakeDb()

    const result = await ingestFxRates(db.client as never, fetch)

    expect(fetch).toHaveBeenCalledWith('https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa', expect.anything())
    expect(fetch).toHaveBeenCalledWith('https://api.argentinadatos.com/v1/cotizaciones/dolares/contadoconliqui', expect.anything())
    expect(db.client.from).toHaveBeenCalledWith('fx_rates')
    expect(db.upsert.mock.calls.flatMap((c) => c[0])).toEqual([
      { date: '2026-10-21', kind: 'mep', buy: 1540, sell: 1550, source: 'argentinadatos' },
      { date: '2026-10-22', kind: 'mep', buy: 1547.8, sell: 1553.8, source: 'argentinadatos' },
      { date: '2026-10-22', kind: 'ccl', buy: 1635.1, sell: 1638, source: 'argentinadatos' },
    ])
    expect(db.upsert.mock.calls[0][1]).toEqual({ onConflict: 'date,kind' })
    expect(result).toEqual({ mep: 2, ccl: 1, written: 3 })
  })

  it('with the history already stored, writes only the day that is new', async () => {
    const db = fakeDb({ stored: [
      { date: '2026-10-21', kind: 'mep', buy: 1540, sell: 1550 },
      { date: '2026-10-22', kind: 'ccl', buy: '1635.1', sell: '1638' },
    ] })

    const result = await ingestFxRates(db.client as never, fakeFetch())

    expect(db.upsert.mock.calls.flatMap((c) => c[0])).toEqual([
      { date: '2026-10-22', kind: 'mep', buy: 1547.8, sell: 1553.8, source: 'argentinadatos' },
    ])
    expect(result).toEqual({ mep: 2, ccl: 1, written: 1 })
  })

  it('writes a stored day again when its rate changed', async () => {
    const db = fakeDb({ stored: [
      { date: '2026-10-21', kind: 'mep', buy: 1540, sell: 1550 },
      { date: '2026-10-22', kind: 'mep', buy: 1547.8, sell: 1550 },
      { date: '2026-10-22', kind: 'ccl', buy: 1635.1, sell: 1638 },
    ] })

    await ingestFxRates(db.client as never, fakeFetch())

    expect(db.upsert.mock.calls.flatMap((c) => c[0]).map((r: { date: string; kind: string }) => `${r.kind} ${r.date}`)).toEqual(['mep 2026-10-22'])
  })

  it('with nothing new it writes nothing', async () => {
    const db = fakeDb({ stored: [
      { date: '2026-10-21', kind: 'mep', buy: 1540, sell: 1550 },
      { date: '2026-10-22', kind: 'mep', buy: 1547.8, sell: 1553.8 },
      { date: '2026-10-22', kind: 'ccl', buy: 1635.1, sell: 1638 },
    ] })

    const result = await ingestFxRates(db.client as never, fakeFetch())

    expect(db.upsert).not.toHaveBeenCalled()
    expect(result).toEqual({ mep: 2, ccl: 1, written: 0 })
  })

  it('reads the stored history in pages of 1000, so a long history is compared whole', async () => {
    const days = Array.from({ length: 1500 }, (_, i) => new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10))
    const db = fakeDb({ stored: days.map((date) => ({ date, kind: 'mep', buy: 1, sell: 2 })) })

    await ingestFxRates(db.client as never, fakeFetch({ bolsa: days.map((fecha) => ({ casa: 'bolsa', compra: 1, venta: 2, fecha })), contadoconliqui: [] }))

    expect(db.ranges.slice(0, 2)).toEqual([[0, 999], [1000, 1999]])
    expect(db.upsert).not.toHaveBeenCalled()
  })

  it('a server that answers fewer rows per page than asked still has its whole history read', async () => {
    const days = Array.from({ length: 1200 }, (_, i) => new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10))
    const db = fakeDb({ stored: days.map((date) => ({ date, kind: 'mep', buy: 1, sell: 2 })), maxRows: 500 })

    await ingestFxRates(db.client as never, fakeFetch({ bolsa: days.map((fecha) => ({ casa: 'bolsa', compra: 1, venta: 2, fecha })), contadoconliqui: [] }))

    expect(db.upsert).not.toHaveBeenCalled()
  })

  it('fails loudly when the stored history cannot be read, writing nothing', async () => {
    const db = fakeDb({ readError: { message: 'timeout' } })

    await expect(ingestFxRates(db.client as never, fakeFetch())).rejects.toThrow(/fx_rates read.*timeout/)
    expect(db.upsert).not.toHaveBeenCalled()
  })

  it('upserts in chunks so the full history fits in requests of at most 1000 rows', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({ casa: 'bolsa', compra: 1, venta: 2, fecha: `2020-01-${i}` }))
    const db = fakeDb()

    await ingestFxRates(db.client as never, fakeFetch({ bolsa: many, contadoconliqui: [] }))

    expect(db.upsert.mock.calls.map((c) => c[0].length)).toEqual([1000, 1000, 500])
  })

  it('skips rows without a positive buy and sell instead of storing a zero rate', async () => {
    const db = fakeDb()

    await ingestFxRates(db.client as never, fakeFetch({
      bolsa: [{ casa: 'bolsa', compra: 0, venta: 0, fecha: '2026-10-20' }, ...series.bolsa],
      contadoconliqui: [{ casa: 'contadoconliqui', compra: null, venta: 1638, fecha: '2026-10-21' }],
    }))

    expect(db.upsert.mock.calls.flatMap((c) => c[0]).map((r: { date: string }) => r.date)).toEqual(['2026-10-21', '2026-10-22'])
  })

  it('fails loudly when a series cannot be fetched, writing nothing', async () => {
    const db = fakeDb()

    await expect(ingestFxRates(db.client as never, fakeFetch({ contadoconliqui: undefined }))).rejects.toThrow(/contadoconliqui.*500/)
    expect(db.upsert).not.toHaveBeenCalled()
  })

  it('fails loudly when the upsert fails', async () => {
    const db = fakeDb({ upsertError: { message: 'denied' } })

    await expect(ingestFxRates(db.client as never, fakeFetch())).rejects.toThrow(/denied/)
  })
})

describe('getFxRate', () => {
  function dbReturning(row: unknown, error: unknown = null) {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error }),
    }
    return { client: { from: vi.fn(() => chain) }, chain }
  }

  it('returns the average of buy and sell of that date, with the date used', async () => {
    const db = dbReturning({ date: '2026-10-22', buy: 1547.8, sell: 1553.8 })

    expect(await getFxRate(db.client as never, '2026-10-22', 'mep')).toEqual({ rate: 1550.8, date: '2026-10-22' })
    expect(db.chain.eq).toHaveBeenCalledWith('kind', 'mep')
    expect(db.chain.lte).toHaveBeenCalledWith('date', '2026-10-22')
    expect(db.chain.order).toHaveBeenCalledWith('date', { ascending: false })
  })

  it('falls back to the previous available day and says which day it used', async () => {
    const db = dbReturning({ date: '2026-10-17', buy: 1500, sell: 1510 })

    expect(await getFxRate(db.client as never, '2026-10-19', 'ccl')).toEqual({ rate: 1505, date: '2026-10-17' })
  })

  it('returns null when there is no rate on or before that date', async () => {
    expect(await getFxRate(dbReturning(null).client as never, '2010-01-01', 'mep')).toBeNull()
  })

  it('throws on a database error instead of answering null', async () => {
    await expect(getFxRate(dbReturning(null, { message: 'boom' }).client as never, '2026-10-22', 'mep')).rejects.toThrow(/boom/)
  })
})
