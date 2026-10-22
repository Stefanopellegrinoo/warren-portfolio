import { describe, it, expect } from 'vitest'
import { deriveCedearEngineValues, recordCedearTrade, TradeRecordError } from '../trade-record'

const base = { tradeQuantity: 40, tradeCommission: 0, ratio: 20, fxMep: 1450, fxCcl: 1500 }

describe('deriveCedearEngineValues', () => {
  it('turns the CEDEAR count into underlying shares', () => {
    const v = deriveCedearEngineValues({ ...base, tradeCurrency: 'CCL', tradePrice: 10 })
    expect(v.quantity).toBe(2)
  })

  it('ARS: price per share in USD-CCL is tradePrice * ratio / ccl', () => {
    const v = deriveCedearEngineValues({ ...base, tradeCurrency: 'ARS', tradePrice: 15000 })
    expect(v.price).toBeCloseTo(200, 10)
  })

  it('MEP: price per share in USD-CCL is tradePrice * mep * ratio / ccl', () => {
    const v = deriveCedearEngineValues({ ...base, tradeCurrency: 'MEP', tradePrice: 10 })
    expect(v.price).toBeCloseTo((10 * 1450 * 20) / 1500, 10)
  })

  it('CCL: price per share is tradePrice * ratio, with no FX', () => {
    const v = deriveCedearEngineValues({ ...base, fxMep: null, fxCcl: null, tradeCurrency: 'CCL', tradePrice: 10 })
    expect(v.price).toBe(200)
  })

  it('converts the commission like the price but without the ratio (it is a total)', () => {
    expect(deriveCedearEngineValues({ ...base, tradeCurrency: 'ARS', tradePrice: 1, tradeCommission: 3000 }).commission).toBeCloseTo(2, 10)
    expect(deriveCedearEngineValues({ ...base, tradeCurrency: 'MEP', tradePrice: 1, tradeCommission: 3 }).commission).toBeCloseTo(2.9, 10)
    expect(deriveCedearEngineValues({ ...base, tradeCurrency: 'CCL', tradePrice: 1, tradeCommission: 3 }).commission).toBe(3)
  })

  it('refuses to derive without the FX the currency needs', () => {
    expect(() => deriveCedearEngineValues({ ...base, fxCcl: null, tradeCurrency: 'ARS', tradePrice: 1 })).toThrow(TradeRecordError)
    expect(() => deriveCedearEngineValues({ ...base, fxMep: null, tradeCurrency: 'MEP', tradePrice: 1 })).toThrow(TradeRecordError)
  })
})

/** Minimal client: `cedears` by ticker and `fx_rates` by kind with date fallback. */
function client(opts: { ratio?: number | null; fx?: Record<'mep' | 'ccl', { date: string; buy: number; sell: number } | null> }) {
  const fx = opts.fx ?? { mep: { date: '2026-10-20', buy: 1440, sell: 1460 }, ccl: { date: '2026-10-20', buy: 1490, sell: 1510 } }
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = (c: string, v: unknown) => { filters[c] = v; return chain }
      chain.lte = () => chain
      chain.order = () => chain
      chain.limit = () => chain
      chain.maybeSingle = async () => {
        if (table === 'cedears') return { data: opts.ratio == null ? null : { ratio: opts.ratio }, error: null }
        if (table === 'fx_rates') return { data: fx[filters.kind as 'mep' | 'ccl'], error: null }
        throw new Error(`unexpected table ${table}`)
      }
      return chain
    },
  } as never
}

const trade = {
  date: '2026-10-20', ticker: 'AAPL', operation: 'COMPRA' as const, assetType: 'CEDEAR' as const,
  tradeCurrency: 'ARS' as const, tradeQuantity: 40, tradePrice: 15000, tradeCommission: 3000,
}

describe('recordCedearTrade', () => {
  it('fills the FX of the trade date from fx_rates and marks it reference', async () => {
    const r = await recordCedearTrade(client({ ratio: 20 }), trade)
    expect(r.quantity).toBe(2)
    expect(r.price).toBeCloseTo(200, 10)
    expect(r.commission).toBeCloseTo(2, 10)
    expect(r.moneda).toBe('ARS')
    expect(r.tradeRecord).toEqual({
      tradeCurrency: 'ARS', tradeQuantity: 40, tradePrice: 15000, tradeCommission: 3000,
      cedearRatio: 20, fxMep: 1450, fxCcl: 1500, fxDate: '2026-10-20', fxSource: 'reference',
    })
  })

  it('keeps an FX the user typed and marks the record user', async () => {
    const r = await recordCedearTrade(client({ ratio: 20 }), { ...trade, fxCcl: 1600 })
    expect(r.price).toBeCloseTo((15000 * 20) / 1600, 10)
    expect(r.tradeRecord.fxCcl).toBe(1600)
    expect(r.tradeRecord.fxMep).toBe(1450)
    expect(r.tradeRecord.fxSource).toBe('user')
  })

  it('records the fallback date when the trade date had no rate', async () => {
    const fx = { mep: { date: '2026-10-17', buy: 1450, sell: 1450 }, ccl: { date: '2026-10-17', buy: 1500, sell: 1500 } }
    const r = await recordCedearTrade(client({ ratio: 20, fx }), { ...trade, date: '2026-10-19' })
    expect(r.tradeRecord.fxDate).toBe('2026-10-17')
  })

  it('stores MEP and CCL trades as USD in the legacy moneda column', async () => {
    const r = await recordCedearTrade(client({ ratio: 20 }), { ...trade, tradeCurrency: 'MEP', tradePrice: 10, tradeCommission: 0 })
    expect(r.moneda).toBe('USD')
  })

  it('refuses a ticker that is not in the CEDEAR list', async () => {
    await expect(recordCedearTrade(client({ ratio: null }), trade)).rejects.toMatchObject({ status: 400 })
  })

  it('refuses when there is no reference FX and the user typed none', async () => {
    await expect(recordCedearTrade(client({ ratio: 20, fx: { mep: null, ccl: null } }), trade)).rejects.toMatchObject({ status: 422 })
  })
})
