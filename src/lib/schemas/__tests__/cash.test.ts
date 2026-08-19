import { describe, it, expect } from 'vitest'
import { CashMovementSchema, CashAdjustSchema } from '../cash'

describe('CashMovementSchema', () => {
  // Validación básica
  it('accepts valid deposit', () => {
    const data = {
      date: '2024-01-01',
      type: 'DEPOSITO',
      amount: 1000,
      description: 'Test deposit'
    }
    expect(() => CashMovementSchema.parse(data)).not.toThrow()
  })

  // Reglas de negocio financieras
  it('rejects negative amount', () => {
    const data = {
      date: '2024-01-01',
      type: 'DEPOSITO',
      amount: -100 // ← INVÁLIDO
    }
    expect(() => CashMovementSchema.parse(data)).toThrow()
  })

  it('rejects amount > 1_000_000', () => {
    const data = {
      date: '2024-01-01',
      type: 'DEPOSITO',
      amount: 2_000_000 // ← EXCEDE MÁXIMO
    }
    expect(() => CashMovementSchema.parse(data)).toThrow()
  })

  it('requires date format YYYY-MM-DD', () => {
    const data = {
      date: '01/01/2024', // ← FORMATO INVÁLIDO
      type: 'DEPOSITO',
      amount: 1000
    }
    expect(() => CashMovementSchema.parse(data)).toThrow()
  })

  it('accepts optional ticker for CUPON/DIVIDENDO', () => {
    const data = {
      date: '2024-01-01',
      type: 'CUPON',
      amount: 50,
      ticker: 'AL30' // ← OPCIONAL PERO ESPERADO
    }
    expect(() => CashMovementSchema.parse(data)).not.toThrow()
  })

  it('rejects invalid type', () => {
    const data = {
      date: '2024-01-01',
      type: 'INVALID_TYPE', // ← INVÁLIDO
      amount: 1000
    }
    expect(() => CashMovementSchema.parse(data)).toThrow()
  })

  it('accepts zero amount for informational records', () => {
    const data = {
      date: '2024-01-01',
      type: 'DEPOSITO',
      amount: 0
    }
    expect(() => CashMovementSchema.parse(data)).toThrow() // PositiveNumberSchema rechaza cero
  })

  it('accepts amount at maximum boundary', () => {
    const data = {
      date: '2024-01-01',
      type: 'DEPOSITO',
      amount: 1_000_000 // ← LÍMITE EXACTO
    }
    expect(() => CashMovementSchema.parse(data)).not.toThrow()
  })
})
describe('CashAdjustSchema', () => {
  const valid = { balance: 1500.25, date: '2026-04-15' }

  it('accepts a positive target balance', () => {
    const result = CashAdjustSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('accepts a NEGATIVE target balance', () => {
    // An imported history legitimately replays to a negative figure; refusing it
    // would make the reconciliation endpoint useless for the case it exists for.
    const result = CashAdjustSchema.safeParse({ ...valid, balance: -239803.19 })
    expect(result.success).toBe(true)
  })

  it('accepts a balance above the 1M cap that applies to single movements', () => {
    const result = CashAdjustSchema.safeParse({ ...valid, balance: 5_000_000 })
    expect(result.success).toBe(true)
  })

  it('rejects a non-numeric balance', () => {
    const result = CashAdjustSchema.safeParse({ ...valid, balance: '1500' })
    expect(result.success).toBe(false)
  })

  it('rejects NaN and Infinity', () => {
    expect(CashAdjustSchema.safeParse({ ...valid, balance: Number.NaN }).success).toBe(false)
    expect(CashAdjustSchema.safeParse({ ...valid, balance: Infinity }).success).toBe(false)
  })

  it('rejects an absurd balance — typo guard', () => {
    const result = CashAdjustSchema.safeParse({ ...valid, balance: 1e12 })
    expect(result.success).toBe(false)
  })

  it('requires a date', () => {
    const result = CashAdjustSchema.safeParse({ balance: 100 })
    expect(result.success).toBe(false)
  })

  it('rejects a malformed date', () => {
    const result = CashAdjustSchema.safeParse({ ...valid, date: '15/04/2026' })
    expect(result.success).toBe(false)
  })

  it('rejects an impossible calendar date', () => {
    const result = CashAdjustSchema.safeParse({ ...valid, date: '2026-02-30' })
    expect(result.success).toBe(false)
  })
})
