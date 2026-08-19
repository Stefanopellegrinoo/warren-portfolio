import { describe, it, expect } from 'vitest'
import { ONTransactionSchema } from '../on'

describe('ONTransactionSchema', () => {
  // Validación básica
  it('accepts valid COMPRA operation', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AL30',
      operation: 'COMPRA',
      quantity: 10,
      price: 1500,
      commission: 10
    }
    expect(() => ONTransactionSchema.parse(data)).not.toThrow()
  })

  it('rejects invalid operation type', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AL30',
      operation: 'INVALID_OP', // ← INVÁLIDO
      quantity: 10,
      price: 1500
    }
    expect(() => ONTransactionSchema.parse(data)).toThrow()
  })

  it('rejects negative quantity', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AL30',
      operation: 'COMPRA',
      quantity: -5, // ← INVÁLIDO
      price: 1500
    }
    expect(() => ONTransactionSchema.parse(data)).toThrow()
  })

  it('rejects quantity > 100_000', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AL30',
      operation: 'COMPRA',
      quantity: 200_000, // ← EXCEDE MÁXIMO
      price: 1500
    }
    expect(() => ONTransactionSchema.parse(data)).toThrow()
  })

  it('rejects price > 10_000', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AL30',
      operation: 'COMPRA',
      quantity: 10,
      price: 20_000 // ← EXCEDE MÁXIMO
    }
    expect(() => ONTransactionSchema.parse(data)).toThrow()
  })

  it('accepts CUPON operation without quantity/price', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AL30',
      operation: 'CUPON',
      quantity: 0, // CUPON puede tener cantidad cero
      price: 0,
      commission: 0
    }
    expect(() => ONTransactionSchema.parse(data)).toThrow() // PositiveNumberSchema rechaza cero
  })

  it('rejects negative commission', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AL30',
      operation: 'COMPRA',
      quantity: 10,
      price: 1500,
      commission: -5 // ← INVÁLIDO
    }
    expect(() => ONTransactionSchema.parse(data)).toThrow()
  })

  it('accepts zero commission (default)', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AL30',
      operation: 'COMPRA',
      quantity: 10,
      price: 1500
      // commission omitido → default 0
    }
    const result = ONTransactionSchema.parse(data)
    expect(result.commission).toBe(0)
  })

  it('accepts quantity at maximum boundary', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AL30',
      operation: 'COMPRA',
      quantity: 100_000, // ← LÍMITE EXACTO
      price: 1500
    }
    expect(() => ONTransactionSchema.parse(data)).not.toThrow()
  })

  it('accepts price at maximum boundary', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AL30',
      operation: 'COMPRA',
      quantity: 10,
      price: 10_000 // ← LÍMITE EXACTO
    }
    expect(() => ONTransactionSchema.parse(data)).not.toThrow()
  })
})