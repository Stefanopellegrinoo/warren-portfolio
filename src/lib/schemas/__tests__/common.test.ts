import { PaginationSchema, DateSchema, PositiveNumberSchema, TickerSchema } from '../common'

describe('PaginationSchema', () => {
  it('accepts valid pagination params', () => {
    const data = {
      page: 1,
      limit: 50
    }
    expect(() => PaginationSchema.parse(data)).not.toThrow()
  })

  it('rejects page < 1', () => {
    const data = {
      page: 0, // ← INVÁLIDO
      limit: 50
    }
    expect(() => PaginationSchema.parse(data)).toThrow()
  })

  it('rejects limit > 100', () => {
    const data = {
      page: 1,
      limit: 200 // ← EXCEDE MÁXIMO
    }
    expect(() => PaginationSchema.parse(data)).toThrow()
  })

  it('rejects limit < 1', () => {
    const data = {
      page: 1,
      limit: 0 // ← INVÁLIDO
    }
    expect(() => PaginationSchema.parse(data)).toThrow()
  })

  it('sets default values when omitted', () => {
    const data = {}
    const result = PaginationSchema.parse(data)
    expect(result.page).toBe(1)
    expect(result.limit).toBe(50)
  })

  it('accepts page at minimum boundary', () => {
    const data = {
      page: 1, // ← LÍMITE MÍNIMO
      limit: 50
    }
    expect(() => PaginationSchema.parse(data)).not.toThrow()
  })

  it('accepts limit at maximum boundary', () => {
    const data = {
      page: 1,
      limit: 100 // ← LÍMITE MÁXIMO
    }
    expect(() => PaginationSchema.parse(data)).not.toThrow()
  })

  it('accepts limit at minimum boundary', () => {
    const data = {
      page: 1,
      limit: 1 // ← LÍMITE MÍNIMO
    }
    expect(() => PaginationSchema.parse(data)).not.toThrow()
  })
})

describe('DateSchema', () => {
  it('accepts valid YYYY-MM-DD format', () => {
    expect(() => DateSchema.parse('2024-01-01')).not.toThrow()
  })

  it('rejects invalid format MM/DD/YYYY', () => {
    expect(() => DateSchema.parse('01/01/2024')).toThrow()
  })

  it('rejects invalid format YYYY/MM/DD', () => {
    expect(() => DateSchema.parse('2024/01/01')).toThrow()
  })

  it('rejects invalid date', () => {
    expect(() => DateSchema.parse('2024-13-45')).toThrow()
  })
})

describe('PositiveNumberSchema', () => {
  it('accepts positive number', () => {
    expect(() => PositiveNumberSchema.parse(100)).not.toThrow()
  })

  it('rejects zero', () => {
    expect(() => PositiveNumberSchema.parse(0)).toThrow()
  })

  it('rejects negative number', () => {
    expect(() => PositiveNumberSchema.parse(-100)).toThrow()
  })
})

describe('TickerSchema', () => {
  it('accepts non-empty string', () => {
    expect(() => TickerSchema.parse('AAPL')).not.toThrow()
  })

  it('rejects empty string', () => {
    expect(() => TickerSchema.parse('')).toThrow()
  })

  it('transforms to uppercase', () => {
    const result = TickerSchema.parse('aapl')
    expect(result).toBe('AAPL')
  })

  it('trims whitespace', () => {
    const result = TickerSchema.parse('  aapl  ')
    expect(result).toBe('AAPL')
  })
})