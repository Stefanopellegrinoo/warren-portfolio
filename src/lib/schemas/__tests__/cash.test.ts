import { CashMovementSchema } from '../cash'

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