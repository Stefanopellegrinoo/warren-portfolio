import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseRavaHistory, backfillOnPriceHistory } from '../rava-history'

// Shape verified with a live GET of https://www.rava.com/perfil/descarga-historicos/YM42D (2026-10-22)
const HEADER = '﻿especie,apertura,maximo,minimo,ultimo,fecha,volumen,cierre,timestamp,usd_apertura,usd_maximo,usd_minimo,usd_cierre'
const line = (date: string, close: number, volume: number, hi = close, lo = close) =>
  `YM42D-0002-C-CT-USD,${close},${hi},${lo},${close},${date},${volume},${close},1792638000,0.06,0.06,0.06,0`
const csv = (...lines: string[]) => [HEADER, ...lines].join('\n') + '\n'

describe('parseRavaHistory', () => {
  it('keeps traded days with their raw close and drops no-trade days (volumen=0)', () => {
    const out = parseRavaHistory(csv(
      line('2026-04-07', 105.5, 419880, 106.4, 105.3),
      line('2026-04-08', 105.5, 0, 0, 0),
      line('2026-04-09', 106.25, 467784),
    ))
    expect(out).toEqual([
      { date: '2026-04-07', close: 105.5, volume: 419880 },
      { date: '2026-04-09', close: 106.25, volume: 467784 },
    ])
  })

  it('throws on an unexpected header instead of guessing columns', () => {
    expect(() => parseRavaHistory('foo,bar\n1,2\n')).toThrow(/unexpected Rava header/)
  })
})

interface Row { ticker: string; price_date: string; close: number; source: string }

function fakeSupabase(initial: Row[] = []) {
  const store = [...initial]
  const from = vi.fn(() => ({
    upsert: async (rows: Row[], opts: { onConflict: string; ignoreDuplicates: boolean }) => {
      for (const r of rows) {
        const exists = store.some(s => s.ticker === r.ticker && s.price_date === r.price_date)
        if (!exists) store.push(r)
        else if (!opts.ignoreDuplicates) throw new Error('would overwrite')
      }
      return { error: null }
    },
  }))
  return { client: { from } as any, store }
}

const mockFetch = vi.fn()
beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

const ok = (body: string) => ({ ok: true, status: 200, text: async () => body })

describe('backfillOnPriceHistory', () => {
  it('stores past traded closes with source rava, from the given date, never today', async () => {
    mockFetch.mockResolvedValue(ok(csv(
      line('2026-03-31', 104, 10),
      line('2026-04-07', 105.5, 419880),
      line('2026-10-22', 105.2, 329662),
    )))
    const db = fakeSupabase()
    const n = await backfillOnPriceHistory(db.client, 'YM42D', '2026-04-01', '2026-10-22')
    expect(n).toBe(1)
    expect(db.store).toEqual([{ ticker: 'YM42D', price_date: '2026-04-07', close: 105.5, volume: 419880, source: 'rava' }])
    expect(mockFetch.mock.calls[0][0]).toBe('https://www.rava.com/perfil/descarga-historicos/YM42D')
  })

  it('never overwrites a close we already captured', async () => {
    mockFetch.mockResolvedValue(ok(csv(line('2026-10-16', 999, 5))))
    const db = fakeSupabase([{ ticker: 'YM42D', price_date: '2026-10-16', close: 105, source: 'data912' }])
    await backfillOnPriceHistory(db.client, 'YM42D', '2026-04-01', '2026-10-22')
    expect(db.store).toEqual([{ ticker: 'YM42D', price_date: '2026-10-16', close: 105, source: 'data912' }])
  })

  it('throws on an HTTP error so the caller can retry instead of storing a gap', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, text: async () => '' })
    await expect(backfillOnPriceHistory(fakeSupabase().client, 'YM42D', '2026-04-01', '2026-10-22'))
      .rejects.toThrow(/Rava 503/)
  })
})
