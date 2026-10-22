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

function fakeDb(upsertError: unknown = null) {
  const upsert = vi.fn().mockResolvedValue({ error: upsertError })
  return { client: { from: vi.fn(() => ({ upsert })) }, upsert }
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
    expect(result).toEqual({ mep: 2, ccl: 1 })
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
    const db = fakeDb({ message: 'denied' })

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
