import { NextRequest, NextResponse } from 'next/server'
import { addImportJob, QueueUnavailableError } from '@/lib/queue'
import { parseExcelTransactions, ExcelParseError } from '@/lib/excel-import'
import { TransactionImportSchema } from '@/lib/schemas/transaction'
import { validationErrorResponse } from '@/lib/api/validation'
import type { TransactionInput } from '@/types'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const authResult = await requireUser()
    if (isAuthFailure(authResult)) return authResult.error
    const { user } = authResult

    const contentType = req.headers.get('content-type') ?? ''
    let transactions: TransactionInput[] = []

    if (contentType.includes('application/json')) {
      // Validate JSON body
      try {
        const body = await req.json()
        const validated = TransactionImportSchema.parse(body)
        transactions = validated.transactions
      } catch (error: any) {
        const errors = error.errors?.map((err: any) => ({
          path: err.path.join('.'),
          message: err.message,
        })) || [{ message: 'Invalid request body' }]

        return validationErrorResponse({
          status: 400,
          message: 'Validation failed',
          errors,
        })
      }
    } else if (contentType.includes('multipart/form-data')) {
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

      try {
        transactions = parseExcelTransactions(data)
      } catch (error) {
        if (error instanceof ExcelParseError) {
          return NextResponse.json({
            error: 'Error al validar el archivo Excel',
            details: {
              line: error.line,
              field: error.field,
              message: error.message
            }
          }, { status: 400 })
        }
        throw error // Re-throw unexpected errors
      }
    } else {
      return NextResponse.json({ error: 'Content-Type must be application/json or multipart/form-data' }, { status: 400 })
    }

    if (!transactions.length) {
      return NextResponse.json({ error: 'No valid transactions found' }, { status: 400 })
    }

    // Enqueue background job (async)
    const { searchParams } = new URL(req.url)
    const replace = searchParams.get('replace') === 'true'
    const job = await addImportJob(user.id, transactions, replace)

    return NextResponse.json({
      message: 'Importación iniciada en segundo plano',
      jobId: job.id
    }, { status: 202 })

  } catch (err: any) {
    // Handle validation errors
    if (err.status === 400) {
      return validationErrorResponse(err)
    }

    // Queue unreachable: the import cannot run without it — tell the truth.
    if (err instanceof QueueUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 })
    }

    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
