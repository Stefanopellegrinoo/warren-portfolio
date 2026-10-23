import { NextRequest, NextResponse } from 'next/server'
import { processONTransaction } from '@/lib/on-engine'
import { invalidateUserCache } from '@/lib/redis'
import { validateRequest, validateQueryParams, validationErrorResponse } from '@/lib/api/validation'
import { ONTransactionSchema } from '@/lib/schemas/on'
import { PaginationSchema, PaginatedResponse } from '@/lib/schemas/common'
import { serverError } from '@/lib/api/errors'
import type { ONPosition } from '@/types'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { getFullPortfolio } from '@/lib/portfolio-engine'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { supabase, user } = authResult

  try {
    // Validate request body
    const body = await validateRequest(ONTransactionSchema, request)

    // Process the transaction
    const result = await processONTransaction(supabase, user.id, body)

    // Invalidate Cache since portfolio mutated
    await invalidateUserCache(user.id)

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    // Handle validation errors with proper type narrowing
    const validationError = error as { status?: number; message?: string }

    if (validationError.status === 400) {
      return validationErrorResponse(validationError)
    }

    return serverError('API ON Positions', error)
  }
}

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireUser()
    if (isAuthFailure(authResult)) return authResult.error
    const { supabase, user } = authResult

    // Validate pagination params
    const { page, limit } = validateQueryParams(PaginationSchema, req.url)
    const offset = (page - 1) * limit

    // From the ledger core (never the stored on_positions), in a stable order so a
    // paginated row cannot repeat or vanish.
    const { onPositions } = await getFullPortfolio(supabase, user.id)
    const positions = [...onPositions].sort((a, b) => a.ticker.localeCompare(b.ticker))
    const count = positions.length

    const response: PaginatedResponse<ONPosition> = {
      data: positions.slice(offset, offset + limit),
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    }

    return NextResponse.json(response)
  } catch (err) {
    // Handle validation errors with proper type narrowing
    const validationError = err as { status?: number; message?: string }

    if (validationError.status === 400) {
      return validationErrorResponse(validationError)
    }

    return serverError('API ON Positions', err)
  }
}
