import { describe, it, expect, vi } from 'vitest'

vi.mock('../redis', () => ({ isRedisReady: () => false, getRedis: () => null, SUMMARY_VERSION_TTL: 60 }))
vi.mock('../yahoo-finance', () => ({ fetchQuotesWithFallback: vi.fn(async () => new Map()) }))
vi.mock('../queue', () => ({ addPriceUpdateJob: vi.fn(async () => undefined) }))

import { processTransaction } from '../portfolio-engine'
import { writeSupabase } from './fixtures/ledger-write-supabase'

function client() {
  const sb = writeSupabase()
  const rpc = vi.fn(sb.rpc)
  return Object.assign(sb, { rpc })
}

const input = { date: '2026-10-20', ticker: 'aapl', operation: 'COMPRA' as const, quantity: 2, price: 200, commission: 1, assetType: 'CEDEAR' as const, moneda: 'ARS' as const }

describe('processTransaction RPC parameters', () => {
  it('sends exactly the pre-044 parameters when there is no trade record', async () => {
    const supabase = client()
    await processTransaction(supabase as never, 'user-1', input)
    expect(supabase.rpc).toHaveBeenCalledWith('process_transaction_atomic', {
      p_date: '2026-10-20', p_ticker: 'AAPL', p_operation: 'COMPRA', p_quantity: 2, p_price: 200, p_commission: 1,
      p_notes: null, p_asset_type: 'CEDEAR', p_moneda: 'ARS', p_user_id: 'user-1',
    })
  })

  it('adds the trade-record parameters when the input carries one', async () => {
    const supabase = client()
    const tradeRecord = {
      tradeCurrency: 'ARS' as const, tradeQuantity: 40, tradePrice: 15000, tradeCommission: 3000,
      cedearRatio: 20, fxMep: 1450, fxCcl: 1500, fxDate: '2026-10-20', fxSource: 'reference' as const,
    }
    await processTransaction(supabase as never, 'user-1', { ...input, tradeRecord })
    expect(supabase.rpc).toHaveBeenCalledWith('process_transaction_atomic', expect.objectContaining({
      p_quantity: 2, p_price: 200,
      p_trade_currency: 'ARS', p_trade_quantity: 40, p_trade_price: 15000, p_trade_commission: 3000,
      p_cedear_ratio: 20, p_fx_mep: 1450, p_fx_ccl: 1500, p_fx_date: '2026-10-20', p_fx_source: 'reference',
    }))
  })
})
