import { describe, it, expect } from 'vitest'
import { planTradeRecordBackfill, fxLookupFrom, type LedgerRow } from '../trade-record-backfill'

// Trade dates and load days have different FX on purpose, so a test can tell
// which date each value came from.
const fx = fxLookupFrom([
  { date: '2024-05-10', kind: 'mep', buy: 1000, sell: 1020 }, // 1010
  { date: '2024-05-10', kind: 'ccl', buy: 1040, sell: 1060 }, // 1050
  { date: '2026-03-02', kind: 'mep', buy: 1400, sell: 1400 },
  { date: '2026-03-02', kind: 'ccl', buy: 1500, sell: 1500 },
  { date: '2026-03-16', kind: 'mep', buy: 1440, sell: 1460 }, // 1450 (load day)
  { date: '2026-03-16', kind: 'ccl', buy: 1590, sell: 1610 }, // 1600 (load day)
])
const ratios = new Map([['AAPL', 20], ['MELI', 120], ['KO', 5], ['XYZ', 30]])

const row = (over: Partial<LedgerRow>): LedgerRow => ({
  id: 'r1', date: '2026-03-02', ticker: 'AAPL', operation: 'COMPRA', asset_type: 'ACCION', moneda: 'USD',
  quantity: 1.5, price: 200, commission: 1, created_at: '2026-03-16T14:00:00+00:00', ...over,
})
const plan = (r: LedgerRow) => {
  const { updates, skipped } = planTradeRecordBackfill([r], fx, ratios)
  return { u: updates[0], skipped }
}

describe('fxLookupFrom', () => {
  it('returns the buy/sell average of the date', () => {
    expect(fx('2024-05-10', 'mep')).toEqual({ rate: 1010, date: '2024-05-10' })
  })
  it('falls back to the previous day with a rate', () => {
    expect(fx('2026-03-14', 'ccl')).toEqual({ rate: 1500, date: '2026-03-02' })
  })
  it('returns null before the history starts', () => {
    expect(fx('2020-01-01', 'ccl')).toBeNull()
  })
})

describe('ACCION rows (CEDEARs already in underlying shares and USD-CCL)', () => {
  it('mirror the engine values as a CCL trade with the trade-date FX, reconstructed', () => {
    const { u } = plan(row({}))
    expect(u).toEqual({
      id: 'r1', trade_currency: 'CCL', trade_quantity: 1.5, trade_price: 200, trade_commission: 1,
      cedear_ratio: 20, fx_mep: 1400, fx_ccl: 1500, fx_date: '2026-03-02', fx_source: 'reconstructed',
      needs_review: false, review_note: null,
    })
  })

  it('use the trade date, never the load day, for the FX (all were loaded on 2026-03-16)', () => {
    const { u } = plan(row({ date: '2024-05-10' }))
    expect(u).toMatchObject({ fx_mep: 1010, fx_ccl: 1050, fx_date: '2024-05-10' })
  })

  it('record the fallback date when the trade date had no rate', () => {
    const { u } = plan(row({ date: '2026-03-05' }))
    expect(u.fx_date).toBe('2026-03-02')
  })

  it('store a sale as a positive instrument quantity', () => {
    const { u } = plan(row({ operation: 'VENTA', quantity: -1.5 }))
    expect(u.trade_quantity).toBe(1.5)
  })

  it.each(['DIS', 'PAM', 'TGS'])('flag %s, which is not in the CEDEAR list, for review', ticker => {
    const { u } = plan(row({ ticker }))
    expect(u.needs_review).toBe(true)
    expect(u.cedear_ratio).toBeNull()
    expect(u.trade_currency).toBe('CCL')
    expect(u.review_note).toContain(`${ticker} no figura como CEDEAR`)
  })
})

describe('CEDEAR rows (entered with the old form, converted with the load-day FX)', () => {
  const cedear = (over: Partial<LedgerRow>) => row({ asset_type: 'CEDEAR', date: '2026-03-14', created_at: '2026-03-16T13:00:00+00:00', ...over })

  it('ARS: undo the old conversion with the load-day CCL: tradePrice = price * ccl(load) / ratio', () => {
    // Old form: price = precio * 20 / 1600 → 200 means precio was 16000 ARS.
    const { u } = plan(cedear({ moneda: 'ARS', quantity: 2, price: 200 }))
    expect(u.trade_currency).toBe('ARS')
    expect(u.trade_price).toBeCloseTo(16000, 8)
  })

  it('USD (MEP): tradePrice = price * ccl(load) / (mep(load) * ratio)', () => {
    const { u } = plan(cedear({ moneda: 'USD', quantity: 2, price: 200 }))
    expect(u.trade_currency).toBe('MEP')
    expect(u.trade_price).toBeCloseTo((200 * 1600) / (1450 * 20), 10)
  })

  it('keep the FX columns of the TRADE date, as reference', () => {
    const { u } = plan(cedear({ moneda: 'ARS' }))
    expect(u).toMatchObject({ fx_mep: 1400, fx_ccl: 1500, fx_date: '2026-03-02', fx_source: 'reference', cedear_ratio: 20 })
  })

  it('undo the commission conversion: ARS was divided by the load-day CCL, USD was not converted', () => {
    expect(plan(cedear({ moneda: 'ARS', commission: 2 })).u.trade_commission).toBeCloseTo(3200, 8)
    expect(plan(cedear({ moneda: 'USD', commission: 2 })).u.trade_commission).toBe(2)
  })

  it('count CEDEARs as quantity * ratio, rounded when it is an integer up to the stored precision', () => {
    // 7 CEDEARs of ratio 30 were stored as 0.233333 shares (numeric(18,6)).
    const { u } = plan(cedear({ ticker: 'XYZ', quantity: 0.233333 }))
    expect(u.trade_quantity).toBe(7)
    expect(u.needs_review).toBe(false)
    expect(plan(cedear({ quantity: -0.15 })).u.trade_quantity).toBe(3)
  })

  it('flag a count that is not an integer', () => {
    const { u } = plan(cedear({ quantity: 0.1234 }))
    expect(u.trade_quantity).toBeCloseTo(2.468, 10)
    expect(u.needs_review).toBe(true)
    expect(u.review_note).toContain('no es entera')
  })

  it('flag a row loaded more than 3 days after its trade date, not one loaded 3 days after', () => {
    expect(plan(cedear({ date: '2026-03-13' })).u.needs_review).toBe(false)
    const { u } = plan(cedear({ date: '2026-03-12' }))
    expect(u.needs_review).toBe(true)
    expect(u.review_note).toContain('4 días después')
  })

  it('give both reasons when both apply', () => {
    const { u } = plan(cedear({ date: '2026-03-02', quantity: 0.1234 }))
    expect(u.review_note).toContain('días después')
    expect(u.review_note).toContain('no es entera')
  })

  it('flag a CEDEAR whose ticker is not in the list, without inventing a ticket', () => {
    const { u } = plan(cedear({ ticker: 'ZZZ' }))
    expect(u).toMatchObject({ needs_review: true, trade_currency: null, trade_price: null, trade_quantity: null, cedear_ratio: null })
    expect(u.review_note).toContain('ZZZ no figura')
  })

  it('skip a row whose moneda is neither ARS nor USD', () => {
    const { updates, skipped } = planTradeRecordBackfill([cedear({ moneda: null })], fx, ratios)
    expect(updates).toEqual([])
    expect(skipped).toEqual([{ id: 'r1', reason: 'CEDEAR with moneda null' }])
  })
})

describe('ON rows (typed in dólar MEP)', () => {
  it('mirror the engine values as a MEP trade with the trade-date FX', () => {
    const { u } = plan(row({ asset_type: 'ON', ticker: 'YMCJD', quantity: 300, price: 101.5, commission: 0.5 }))
    expect(u).toEqual({
      id: 'r1', trade_currency: 'MEP', trade_quantity: 300, trade_price: 101.5, trade_commission: 0.5,
      cedear_ratio: null, fx_mep: 1400, fx_ccl: 1500, fx_date: '2026-03-02', fx_source: 'reference',
      needs_review: false, review_note: null,
    })
  })
})

describe('planTradeRecordBackfill', () => {
  it('never touches the engine or identity columns', () => {
    const rows = [row({}), row({ id: 'r2', asset_type: 'CEDEAR', moneda: 'ARS' }), row({ id: 'r3', asset_type: 'ON' })]
    for (const u of planTradeRecordBackfill(rows, fx, ratios).updates) {
      for (const k of ['quantity', 'price', 'commission', 'date', 'ticker', 'asset_type', 'operation', 'moneda', 'user_id']) {
        expect(u).not.toHaveProperty(k)
      }
    }
  })

  it('skips an unknown asset type instead of guessing', () => {
    const { updates, skipped } = planTradeRecordBackfill([row({ asset_type: 'FCI' })], fx, ratios)
    expect(updates).toEqual([])
    expect(skipped).toEqual([{ id: 'r1', reason: 'unknown asset_type FCI' }])
  })
})
