// odd/tasks/split-aware-ledger.md S5: a stock or CEDEAR row with stored splits after its date carries
// `after_splits` (today's share basis) and the line Historial and the trade cards show under it.
import type { Operation } from '@/types'
import { describe, it, expect } from 'vitest'
import { afterSplits, afterSplitsText } from '../after-splits'
import type { SplitEvent } from '../historical-prices'

const GOOGL: SplitEvent[] = [{ date: '2022-07-18', numerator: 20, denominator: 1 }]
const NVDA: SplitEvent[] = [
  { date: '2021-07-20', numerator: 4, denominator: 1 },
  { date: '2024-06-10', numerator: 10, denominator: 1 },
]
const SPLITS = new Map([['GOOGL', GOOGL], ['NVDA', NVDA]])

const row = (over: { ticker?: string; date?: string; quantity?: number; price?: number; asset_type?: 'ACCION' | 'CEDEAR' | 'ON'; operation?: Operation }) => ({
  ticker: 'GOOGL', date: '2022-03-21', quantity: 0.931, price: 2591.6, asset_type: 'CEDEAR' as const, operation: 'COMPRA' as Operation, ...over,
})

describe('afterSplits', () => {
  it('one split after the trade: factor, |quantity| × factor and price / factor', () => {
    expect(afterSplits(row({}), SPLITS)).toEqual({ splits: GOOGL, factor: 20, quantity: 0.931 * 20, price: 2591.6 / 20 })
    // A sale is stored negative; the quantity in today's basis is its size.
    expect(afterSplits(row({ quantity: -1 }), SPLITS)?.quantity).toBe(20)
  })

  it('several splits after the trade multiply, oldest first', () => {
    expect(afterSplits(row({ ticker: 'NVDA', date: '2021-01-05', quantity: 2, price: 520, asset_type: 'ACCION' }), SPLITS))
      .toEqual({ splits: NVDA, factor: 40, quantity: 80, price: 13 })
  })

  it('only the splits dated after the trade count', () => {
    expect(afterSplits(row({ ticker: 'NVDA', date: '2022-01-03', quantity: 2, price: 300 }), SPLITS))
      .toEqual({ splits: [NVDA[1]], factor: 10, quantity: 20, price: 30 })
  })

  it('none on or after the last split date: a trade on the ex-date is already on the new basis', () => {
    expect(afterSplits(row({ ticker: 'NVDA', date: '2024-06-10' }), SPLITS)).toBeUndefined()
    expect(afterSplits(row({ ticker: 'NVDA', date: '2025-02-01' }), SPLITS)).toBeUndefined()
  })

  it('none for a dividend: its price is income per share, not a share price', () => {
    expect(afterSplits(row({ operation: 'DIVIDENDO' }), SPLITS)).toBeUndefined()
    expect(afterSplits(row({ operation: 'VENTA', quantity: -0.931 }), SPLITS)?.quantity).toBeCloseTo(18.62, 10)
  })

  it('none for an ON, nor for a ticker with no stored splits', () => {
    expect(afterSplits(row({ asset_type: 'ON' }), SPLITS)).toBeUndefined()
    expect(afterSplits(row({ ticker: 'KO' }), SPLITS)).toBeUndefined()
  })
})

describe('afterSplitsText', () => {
  it('one split: the exact Spanish line, dd/mm/yyyy, the UI number formats', () => {
    expect(afterSplitsText(afterSplits(row({}), SPLITS)!)).toBe('Tras el split 20:1 del 18/07/2022: 18,62 acciones a US$ 129,58')
  })

  it('two splits: " y " before the last', () => {
    expect(afterSplitsText({ splits: NVDA, factor: 40, quantity: 80, price: 13 }))
      .toBe('Tras los splits 4:1 del 20/07/2021 y 10:1 del 10/06/2024: 80 acciones a US$ 13,00')
  })

  it('three splits: ", " between items and " y " before the last', () => {
    const splits = [
      { date: '2005-02-28', numerator: 2, denominator: 1 },
      { date: '2014-06-09', numerator: 7, denominator: 1 },
      { date: '2020-08-31', numerator: 4, denominator: 1 },
    ]
    expect(afterSplitsText({ splits, factor: 56, quantity: 1120, price: 2.5 }))
      .toBe('Tras los splits 2:1 del 28/02/2005, 7:1 del 09/06/2014 y 4:1 del 31/08/2020: 1.120 acciones a US$ 2,50')
  })
})
