import type { TransactionInput } from '@/types'

export function parseExcelTransactions(data: unknown[][]): TransactionInput[] {
  const results: TransactionInput[] = []

  for (let i = 1; i < data.length; i++) {
    const row = data[i]
    if (!row || !row[0]) continue

    try {
      // Expected columns: FECHA | TICKER | OPERACIÓN | CANTIDAD | PRECIO UNIT. | COMISIÓN
      const rawDate = row[0]
      const ticker = String(row[1] || '').trim()
      const operation = String(row[2] || '').trim().toUpperCase()
      const quantity = Math.abs(parseFloat(String(row[3] || '0')))
      const price = parseFloat(String(row[4] || '0'))
      const commission = parseFloat(String(row[5] || '0')) || 0

      if (!ticker || !operation || !quantity || !price) continue
      if (!['COMPRA', 'VENTA', 'DIVIDENDO'].includes(operation)) continue

      // Parse date — handles Excel Date objects, serial dates and DD/MM/YYYY strings
      let dateStr: string
      if (rawDate instanceof Date) {
        dateStr = rawDate.toISOString().split('T')[0]
      } else if (typeof rawDate === 'number') {
        // Excel serial date
        const date = new Date((rawDate - 25569) * 86400 * 1000)
        dateStr = date.toISOString().split('T')[0]
      } else {
        const str = String(rawDate || '').trim()
        const parts = str.split('/')
        if (parts.length === 3) {
          const [d, m, y] = parts
          dateStr = `${y.length === 2 ? '20' + y : y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
        } else {
          // Try to see if it's already a valid date string that JS can parse
          const parsed = new Date(str)
          if (!isNaN(parsed.getTime())) {
            dateStr = parsed.toISOString().split('T')[0]
          } else {
            dateStr = str // fallback
          }
        }
      }

      results.push({ date: dateStr, ticker, operation: operation as 'COMPRA' | 'VENTA' | 'DIVIDENDO', quantity, price, commission })
    } catch {
      // Skip malformed rows
    }
  }

  return results
}
