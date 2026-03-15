import { NextRequest, NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { processTransaction } from '@/lib/portfolio-engine'
import { parseExcelTransactions } from '@/lib/excel-import'
import type { TransactionInput } from '@/types'

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClientInstance()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const contentType = req.headers.get('content-type') ?? ''

    let transactions: TransactionInput[] = []

    if (contentType.includes('application/json')) {
      // Direct JSON array import
      const body = await req.json()
      transactions = body.transactions ?? []
    } else if (contentType.includes('multipart/form-data')) {
      // Excel file upload
      const formData = await req.formData()
      const file = formData.get('file') as File | null
      if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

      const buffer = await file.arrayBuffer()
      const XLSX = await import('xlsx')
      const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
      const sheetName = workbook.SheetNames.find(n =>
        n.toLowerCase().includes('registro')) ?? workbook.SheetNames[0]
      const sheet = workbook.Sheets[sheetName]
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][]
      transactions = parseExcelTransactions(data)
    }



    if (!transactions.length) {
      return NextResponse.json({ error: 'No valid transactions found' }, { status: 400 })
    }

    // Sort by date ascending (critical for correct avg cost calculation)
    transactions.sort((a, b) => a.date.localeCompare(b.date))

    // Clear existing data for fresh import (optional — only if user requests)
    const { searchParams } = new URL(req.url)
    if (searchParams.get('replace') === 'true') {
      await supabase.from('transactions').delete().eq('user_id', user.id)
      await supabase.from('positions').delete().eq('user_id', user.id)
      await supabase.from('closed_trades').delete().eq('user_id', user.id)
    }

    // Process each transaction sequentially (order matters!)
    const results = { imported: 0, errors: 0, details: [] as string[] }

    for (const tx of transactions) {
      try {
        await processTransaction(user.id, tx)
        results.imported++
      } catch (err) {
        results.errors++
        results.details.push(`${tx.date} ${tx.ticker}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    return NextResponse.json(results, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
