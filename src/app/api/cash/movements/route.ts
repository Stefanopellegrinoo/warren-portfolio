import { NextRequest, NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { validateQueryParams, validationErrorResponse } from '@/lib/api/validation'
import { CashMovementQuerySchema } from '@/lib/schemas/cash'
import { PaginatedResponse } from '@/lib/schemas/common'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClientInstance()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Validate query params
    const { limit, offset, type } = validateQueryParams(CashMovementQuerySchema, req.url)

    let query = supabase
      .from('cash_movements')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (type) query = query.eq('type', type)

    const { data: movements, error, count } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Calculate pagination metadata
    const page = Math.floor(offset / limit) + 1
    const totalPages = count ? Math.ceil(count / limit) : 0

    const response: PaginatedResponse<any> = {
      data: movements ?? [],
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages,
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
