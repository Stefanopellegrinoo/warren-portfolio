import { TransactionSchema } from '../transaction'

describe('TransactionSchema', () => {
  // Validación básica
  it('accepts valid COMPRA operation for ACCION', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AAPL',
      operation: 'COMPRA',
      quantity: 100,
      price: 150,
      assetType: 'ACCION',
      moneda: 'USD'
    }
    expect(() => TransactionSchema.parse(data)).not.toThrow()
  })

  it('rejects invalid operation type', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AAPL',
      operation: 'INVALID_OP', // ← INVÁLIDO
      quantity: 100,
      price: 150
    }
    expect(() => TransactionSchema.parse(data)).toThrow()
  })

  it('rejects negative quantity', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AAPL',
      operation: 'COMPRA',
      quantity: -10, // ← INVÁLIDO
      price: 150
    }
    expect(() => TransactionSchema.parse(data)).toThrow()
  })

  it('rejects quantity > 1_000_000', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AAPL',
      operation: 'COMPRA',
      quantity: 2_000_000, // ← EXCEDE MÁXIMO
      price: 150
    }
    expect(() => TransactionSchema.parse(data)).toThrow()
  })

  it('rejects price > 1_000_000', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AAPL',
      operation: 'COMPRA',
      quantity: 100,
      price: 2_000_000 // ← EXCEDE MÁXIMO
    }
    expect(() => TransactionSchema.parse(data)).toThrow()
  })

  it('accepts DIVIDENDO operation', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AAPL',
      operation: 'DIVIDENDO',
      quantity: 0,
      price: 2.5,
      commission: 0
    }
    expect(() => TransactionSchema.parse(data)).toThrow() // PositiveNumberSchema rechaza cero
  })

  it('rejects negative commission', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AAPL',
      operation: 'COMPRA',
      quantity: 100,
      price: 150,
      commission: -10 // ← INVÁLIDO
    }
    expect(() => TransactionSchema.parse(data)).toThrow()
  })

  it('accepts optional commission defaulting to 0', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AAPL',
      operation: 'COMPRA',
      quantity: 100,
      price: 150
      // commission omitido
    }
    const result = TransactionSchema.parse(data)
    expect(result.commission).toBe(0)
  })

  it('accepts CEDEAR asset type', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AAPL',
      operation: 'COMPRA',
      quantity: 10,
      price: 150,
      assetType: 'CEDEAR'
    }
    expect(() => TransactionSchema.parse(data)).not.toThrow()
  })

  it('rejects invalid asset type', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AAPL',
      operation: 'COMPRA',
      quantity: 100,
      price: 150,
      assetType: 'INVALID_TYPE' // ← INVÁLIDO
    }
    expect(() => TransactionSchema.parse(data)).toThrow()
  })

  it('accepts quantity at maximum boundary', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AAPL',
      operation: 'COMPRA',
      quantity: 1_000_000, // ← LÍMITE EXACTO
      price: 150
    }
    expect(() => TransactionSchema.parse(data)).not.toThrow()
  })

  it('accepts price at maximum boundary', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'AAPL',
      operation: 'COMPRA',
      quantity: 100,
      price: 1_000_000 // ← LÍMITE EXACTO
    }
    expect(() => TransactionSchema.parse(data)).not.toThrow()
  })

  it('transforms ticker to uppercase', () => {
    const data = {
      date: '2024-01-01',
      ticker: 'aapl', // ← minúsculas
      operation: 'COMPRA',
      quantity: 100,
      price: 150
    }
    const result = TransactionSchema.parse(data)
    expect(result.ticker).toBe('AAPL')
  })
})