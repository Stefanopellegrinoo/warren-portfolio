import type { TransactionInput } from '@/types'

export class ExcelParseError extends Error {
  constructor(
    message: string,
    public line: number,
    public field?: string
  ) {
    super(message)
    this.name = 'ExcelParseError'
  }
}

export function parseExcelTransactions(data: unknown[][]): TransactionInput[] {
  const results: TransactionInput[] = []

  for (let i = 1; i < data.length; i++) {
    const row = data[i]
    const lineNumber = i + 1 // +1 because Excel rows are 1-indexed
    
    // Skip completely empty rows
    if (!row || row.every(cell => cell === null || cell === undefined || cell === '')) {
      continue
    }

    // Expected columns: FECHA | TICKER | OPERACIÓN | CANTIDAD | PRECIO UNIT. | COMISIÓN
    const rawDate = row[0]
    const rawTicker = row[1]
    const rawOperation = row[2]
    const rawQuantity = row[3]
    const rawPrice = row[4]
    const rawCommission = row[5]

    // ═══════════════════════════════════════════════════════════════════════
    // FAIL-FAST VALIDATION: Any error immediately aborts the entire import
    // ═══════════════════════════════════════════════════════════════════════

    // Validate DATE field exists
    if (rawDate === null || rawDate === undefined || rawDate === '') {
      throw new ExcelParseError(
        `Línea ${lineNumber}: Falta el campo FECHA`,
        lineNumber,
        'FECHA'
      )
    }

    // Validate TICKER field exists
    const ticker = String(rawTicker || '').trim()
    if (!ticker) {
      throw new ExcelParseError(
        `Línea ${lineNumber}: Falta el campo TICKER`,
        lineNumber,
        'TICKER'
      )
    }

    // Validate OPERATION field exists
    const operation = String(rawOperation || '').trim().toUpperCase()
    if (!operation) {
      throw new ExcelParseError(
        `Línea ${lineNumber}: Falta el campo OPERACIÓN`,
        lineNumber,
        'OPERACIÓN'
      )
    }

    // Validate OPERATION type
    if (!['COMPRA', 'VENTA', 'DIVIDENDO'].includes(operation)) {
      throw new ExcelParseError(
        `Línea ${lineNumber}: Operación inválida "${operation}". Debe ser COMPRA, VENTA o DIVIDENDO`,
        lineNumber,
        'OPERACIÓN'
      )
    }

    // Validate QUANTITY field exists and is valid number
    const quantity = Math.abs(parseFloat(String(rawQuantity || '0')))
    if (!rawQuantity || isNaN(quantity) || quantity <= 0) {
      throw new ExcelParseError(
        `Línea ${lineNumber}: Cantidad inválida o faltante (debe ser mayor a 0)`,
        lineNumber,
        'CANTIDAD'
      )
    }

    // Validate PRICE field exists and is valid number
    const price = parseFloat(String(rawPrice || '0'))
    if (!rawPrice || isNaN(price) || price <= 0) {
      throw new ExcelParseError(
        `Línea ${lineNumber}: Precio inválido o faltante (debe ser mayor a 0)`,
        lineNumber,
        'PRECIO UNIT.'
      )
    }

    // Parse COMMISSION (optional field, defaults to 0)
    const commission = parseFloat(String(rawCommission || '0')) || 0

    // ═══════════════════════════════════════════════════════════════════════
    // Parse DATE field - handles multiple formats
    // ═══════════════════════════════════════════════════════════════════════
    let dateStr: string
    
    try {
      if (rawDate instanceof Date) {
        dateStr = rawDate.toISOString().split('T')[0]
      } else if (typeof rawDate === 'number') {
        // Excel serial date
        const date = new Date((rawDate - 25569) * 86400 * 1000)
        if (isNaN(date.getTime())) {
          throw new Error('Invalid Excel date serial')
        }
        dateStr = date.toISOString().split('T')[0]
      } else {
        const str = String(rawDate).trim()
        
        // Try DD/MM/YYYY format
        const parts = str.split('/')
        if (parts.length === 3) {
          const [d, m, y] = parts
          const year = y.length === 2 ? '20' + y : y
          dateStr = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
          
          // Validate the constructed date
          const testDate = new Date(dateStr)
          if (isNaN(testDate.getTime())) {
            throw new Error('Invalid date format')
          }
        } else {
          // Try to parse as ISO or other standard format
          const parsed = new Date(str)
          if (isNaN(parsed.getTime())) {
            throw new Error('Invalid date format')
          }
          dateStr = parsed.toISOString().split('T')[0]
        }
      }
    } catch (error) {
      throw new ExcelParseError(
        `Línea ${lineNumber}: Fecha inválida "${rawDate}". Formato esperado: DD/MM/YYYY`,
        lineNumber,
        'FECHA'
      )
    }

    // All validations passed - add to results
    results.push({
      date: dateStr,
      ticker,
      operation: operation as 'COMPRA' | 'VENTA' | 'DIVIDENDO',
      quantity,
      price,
      commission
    })
  }

  // If no valid transactions found, throw error
  if (results.length === 0) {
    throw new ExcelParseError(
      'No se encontraron transacciones válidas en el archivo',
      0
    )
  }

  return results
}
