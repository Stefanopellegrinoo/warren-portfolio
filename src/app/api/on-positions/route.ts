import { NextRequest, NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { processONTransaction } from '@/lib/on-engine'
import { invalidateUserCache } from '@/lib/redis'
import { validateRequest, validateQueryParams, validationErrorResponse } from '@/lib/api/validation'
import { ONTransactionSchema } from '@/lib/schemas/on'
import { PaginationSchema, PaginatedResponse } from '@/lib/schemas/common'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const supabase = createServerClientInstance()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // Validate request body
    const body = await validateRequest(ONTransactionSchema, request)
    
    // Process the transaction
    const result = await processONTransaction(user.id, body)
    
    // Invalidate Cache since portfolio mutated
    await invalidateUserCache(user.id)
    
    return NextResponse.json(result, { status: 201 })
  } catch (error: any) {
    // Handle validation errors
    if (error.status === 400) {
      return validationErrorResponse(error)
    }
    
    // Handle other errors
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClientInstance()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Validate pagination params
    const { page, limit } = validateQueryParams(PaginationSchema, req.url)
    const offset = (page - 1) * limit

    const { data: positions, error, count } = await supabase
      .from('on_positions')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const response: PaginatedResponse<any> = {
      data: positions ?? [],
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: count ? Math.ceil(count / limit) : 0,
      },
    }

    return NextResponse.json(response)
  } catch (err: any) {
    if (err.status === 400) {
      return validationErrorResponse(err)
    }
    
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
