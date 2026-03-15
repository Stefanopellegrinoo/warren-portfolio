import { NextRequest, NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { processTransaction } from '@/lib/portfolio-engine'
import type { TransactionInput } from '@/types'

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClientInstance()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const ticker = searchParams.get('ticker')
    const limit = parseInt(searchParams.get('limit') ?? '100')
    const offset = parseInt(searchParams.get('offset') ?? '0')

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

    return NextResponse.json({ data, count })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClientInstance()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body: TransactionInput = await req.json()

    // Validate
    if (!body.date || !body.ticker || !body.operation || !body.quantity || !body.price) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (!['COMPRA', 'VENTA', 'DIVIDENDO'].includes(body.operation)) {
      return NextResponse.json({ error: 'Invalid operation' }, { status: 400 })
    }
    if (body.quantity <= 0) {
      return NextResponse.json({ error: 'Quantity must be positive' }, { status: 400 })
    }

    const result = await processTransaction(user.id, body)

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
