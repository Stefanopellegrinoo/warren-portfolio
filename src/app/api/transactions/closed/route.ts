import { NextRequest, NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { validateQueryParams, validationErrorResponse } from '@/lib/api/validation'
import { TransactionQuerySchema } from '@/lib/schemas/transaction'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClientInstance()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Validate query params
    const { ticker, limit, offset } = validateQueryParams(TransactionQuerySchema, req.url)

    let query = supabase
      .from('closed_trades')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('close_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (ticker) query = query.eq('ticker', ticker.toUpperCase())

    const { data, error, count } = await query
    if (error) throw error

    return NextResponse.json({ data, count })
  } catch (err: any) {
    // Handle validation errors
    if (err.status === 400) {
      return validationErrorResponse(err)
    }
    
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
