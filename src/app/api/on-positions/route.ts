import { NextRequest, NextResponse } from 'next/server'
import { processONTransaction } from '@/lib/on-engine'
import { invalidateUserCache } from '@/lib/redis'
import { validateRequest, validateQueryParams, validationErrorResponse } from '@/lib/api/validation'
import { ONTransactionSchema } from '@/lib/schemas/on'
import { PaginationSchema, PaginatedResponse } from '@/lib/schemas/common'
import { normalizeError } from '@/lib/errors'
import type { ONPosition } from '@/types'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { retroactiveWarnings } from '@/lib/api/retroactive-warning'

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

    const warnings = await retroactiveWarnings(supabase, user.id, body.date)

    return NextResponse.json(warnings.length ? { ...result, warnings } : result, { status: 201 })
  } catch (error) {
    // Handle validation errors with proper type narrowing
    const err = normalizeError(error)
    const validationError = error as { status?: number; message?: string }

    if (validationError.status === 400) {
      return validationErrorResponse(validationError)
    }

    // Handle other errors
    return NextResponse.json(
      { error: err.message || 'Unknown error' },
      { status: 500 }
    )
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

    const { data: positions, error, count } = await supabase
      .from('on_positions')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      // `on_positions` has NO created_at (migration 003 stamps first_bought
      // and last_updated). Ordering by a missing column is not a silent no-op
      // in PostgREST — it fails the request with 42703, which made this route
      // answer 500 for every user until 2026-08-01. `ticker` breaks the tie:
      // the bulk import writes every row in one statement, so last_updated
      // ties across the table, and an unstable sort under `.range()` can serve
      // one position twice and drop another.
      .order('last_updated', { ascending: false })
      .order('ticker', { ascending: true })
      .range(offset, offset + limit - 1)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const response: PaginatedResponse<ONPosition> = {
      data: (positions ?? []) as ONPosition[],
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: count ? Math.ceil(count / limit) : 0,
      },
    }

    return NextResponse.json(response)
  } catch (err) {
    // Handle validation errors with proper type narrowing
    const error = normalizeError(err)
    const validationError = err as { status?: number; message?: string }

    if (validationError.status === 400) {
      return validationErrorResponse(validationError)
    }

    console.error('[API] ON Positions error:', error.message)
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 })
  }
}
