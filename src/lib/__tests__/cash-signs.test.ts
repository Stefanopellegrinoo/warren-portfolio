import { describe, it, expect } from 'vitest'
import { cashDelta } from '../cash-signs'

describe('cashDelta', () => {
  it('credits money coming into the portfolio', () => {
    expect(cashDelta('DEPOSITO', 100)).toBe(100)
    expect(cashDelta('CUPON', 12.5)).toBe(12.5)
    expect(cashDelta('DIVIDENDO', 7)).toBe(7)
    expect(cashDelta('VENTA', 250)).toBe(250)
  })

  it('debits money leaving the portfolio', () => {
    expect(cashDelta('RETIRO', 100)).toBe(-100)
    expect(cashDelta('COMPRA', 250)).toBe(-250)
  })

  it('treats amount as unsigned — the sign lives in the type', () => {
    // The ledger contract: amount is always positive. A negative amount that
    // slipped in must not silently flip a debit into a credit.
    expect(cashDelta('COMPRA', -250)).toBe(-250)
    expect(cashDelta('VENTA', -250)).toBe(250)
  })

  it('ignores an unknown type instead of guessing a direction', () => {
    expect(cashDelta('AJUSTE_RARO', 999)).toBe(0)
  })

  it('THROWS on a non-numeric amount instead of contributing zero', () => {
    // Decided 2026-07-28: a corrupt amount must stop the replay, not quietly
    // contribute nothing. `cash_movements.amount` has NO positivity or
    // numeric CHECK in migration 003, so this is application-enforced only,
    // and the backfill replays ~1150 days — a silent 0 in the middle is the
    // same failure mode as H4 and the `|| 0`.
    expect(() => cashDelta('DEPOSITO', NaN)).toThrow(/non-numeric amount/)
    expect(() => cashDelta('DEPOSITO', undefined as unknown as number)).toThrow()
    expect(() => cashDelta('COMPRA', 'abc' as unknown as number)).toThrow()
  })

  it('names the offending type in the error', () => {
    expect(() => cashDelta('DEPOSITO', NaN)).toThrow(/DEPOSITO/)
  })
})

describe('rebuildCashBalance accumulation', () => {
  // The pre-existing rebuildCashBalance test feeds `movements: []`, so nothing
  // verified the loop's arithmetic before this extraction. This locks it.
  it('sums a mixed run of credits and debits', async () => {
    const { rebuildCashBalance } = await import('../cash-engine')
    const movements = [
      { type: 'DEPOSITO', amount: 1000, date: '2022-02-01' },
      { type: 'COMPRA', amount: 400, date: '2022-02-09' },
      { type: 'VENTA', amount: 150, date: '2022-03-09' },
      { type: 'RETIRO', amount: 50, date: '2022-06-01' },
      { type: 'DIVIDENDO', amount: 25, date: '2022-07-01' },
    ]

    let upserted: any = null
    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            order: () => ({ order: () => ({ data: movements, error: null }) }),
          }),
        }),
        upsert: (row: any) => {
          upserted = row
          return { select: () => ({ single: () => ({ data: row, error: null }) }) }
        },
      }),
    }

    await rebuildCashBalance(supabase as any, '00000000-0000-0000-0000-000000000001')

    // 1000 - 400 + 150 - 50 + 25
    expect(upserted.balance).toBeCloseTo(725, 10)
  })
})
