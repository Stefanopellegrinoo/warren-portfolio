import { describe, it, expect } from 'vitest'
import { loadOnHoldings } from '../on-holdings'
import { ledgerSupabase, trade } from './fixtures/ledger-supabase'

describe('loadOnHoldings — ON holdings from the ledger core', () => {
  it('returns the open ONs only, never reading on_positions', async () => {
    const sb = ledgerSupabase({
      transactions: [
        trade({ ticker: 'ONA', asset_type: 'ON', quantity: 30, price: 95 }),
        trade({ ticker: 'ONA', asset_type: 'ON', operation: 'VENTA', quantity: 10, price: 97, date: '2026-01-06' }),
        trade({ ticker: 'ONB', asset_type: 'ON', quantity: 5, price: 90 }),
        trade({ ticker: 'ONB', asset_type: 'ON', operation: 'VENTA', quantity: 5, price: 91, date: '2026-01-07' }),
        trade(),
      ],
      on_terms: [],
    })

    expect(await loadOnHoldings(sb, 'u1', '2026-02-01')).toEqual([{ ticker: 'ONA', quantity: 20 }])
  })
})
