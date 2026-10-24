import { NextRequest, NextResponse } from 'next/server'
import { addImportJob, QueueUnavailableError } from '@/lib/queue'
import { parseExcelTransactions, ExcelParseError } from '@/lib/excel-import'
import { TransactionImportSchema } from '@/lib/schemas/transaction'
import { INVALID_JSON, validateBody, validationErrorResponse } from '@/lib/api/validation'
import { serverError } from '@/lib/api/errors'
import type { TransactionInput } from '@/types'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
// The 5 MB file plus multipart overhead. Checked from the header because
// req.formData() / req.json() buffer the whole body before any other check runs.
const MAX_BODY_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024

export async function POST(req: NextRequest) {
  try {
    const authResult = await requireUser()
    if (isAuthFailure(authResult)) return authResult.error
    const { user } = authResult

    // ponytail: a chunked body without content-length skips this; the 5 MB file check still runs after parsing.
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'El archivo es demasiado grande. El máximo es 5 MB.' }, { status: 413 })
    }

    const contentType = req.headers.get('content-type') ?? ''
    let transactions: TransactionInput[] = []

    if (contentType.includes('application/json')) {
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return NextResponse.json({ error: INVALID_JSON }, { status: 400 })
      }
      // A rejected field throws { status: 400 }, answered by the catch below.
      transactions = validateBody(TransactionImportSchema, body).transactions
    } else if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const file = formData.get('file') as File | null
      if (!file) return NextResponse.json({ error: 'Elegí un archivo para importar' }, { status: 400 })
      if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'El archivo es demasiado grande. El máximo es 5 MB.' }, { status: 413 })

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
            // Already Spanish and names the line: "Línea 3: Falta el campo FECHA".
            error: error.message,
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
      return NextResponse.json({ error: INVALID_JSON }, { status: 400 })
    }

    if (!transactions.length) {
      return NextResponse.json({ error: 'El archivo no tiene operaciones para importar' }, { status: 400 })
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

    // Queue unreachable: the import cannot run without it — tell the truth, without naming Redis.
    if (err instanceof QueueUnavailableError) {
      return NextResponse.json({ error: 'No se pudo iniciar la importación en este momento. Probá de nuevo en unos minutos.' }, { status: 503 })
    }

    return serverError('Import', err)
  }
}
