import { NextRequest, NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { processTransaction } from '@/lib/portfolio-engine'
import { invalidateUserCache } from '@/lib/redis'
import { validateRequest, validateQueryParams, validationErrorResponse } from '@/lib/api/validation'
import { TransactionSchema, TransactionQuerySchema } from '@/lib/schemas/transaction'
import { PaginatedResponse } from '@/lib/schemas/common'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClientInstance()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Validate query params
    const { ticker, limit, offset } = validateQueryParams(TransactionQuerySchema, req.url)

    let query = supabase
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (ticker) query = query.eq('ticker', ticker.toUpperCase())

    const { data, error, count } = await query
    if (error) throw error

    const page = Math.floor(offset / limit) + 1
    const response: PaginatedResponse<any> = {
      data: data ?? [],
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: count ? Math.ceil(count / limit) : 0,
      },
    }

    return NextResponse.json(response)
  } catch (err: any) {
    // Handle validation errors
    if (err.status === 400) {
      return validationErrorResponse(err)
    }
    
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClientInstance()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Validate request body
    const body = await validateRequest(TransactionSchema, req)

    const result = await processTransaction(supabase, user.id, body)
    // Invalidate Cache since portfolio mutated
    await invalidateUserCache(user.id)

    return NextResponse.json(result, { status: 201 })
  } catch (err: any) {
    // Handle validation errors
    if (err.status === 400) {
      return validationErrorResponse(err)
    }
    
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
