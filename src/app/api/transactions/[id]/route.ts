import { NextRequest, NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { rebuildPosition } from '@/lib/portfolio-engine'
import { invalidateUserCache } from '@/lib/redis'
import { UUIDSchema } from '@/lib/schemas/common'
import { validationErrorResponse } from '@/lib/api/validation'

export const dynamic = 'force-dynamic'

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createServerClientInstance()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Validate UUID
    try {
      UUIDSchema.parse(params.id)
    } catch (error: any) {
      return NextResponse.json(
        { error: 'Invalid transaction ID', details: error.errors },
        { status: 400 }
      )
    }

    // 1. Get the transaction to know the ticker
    const { data: tx, error: getErr } = await supabase
      .from('transactions')
      .select('ticker')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()

    if (getErr || !tx) {
      return NextResponse.json({ error: 'Transaction not found or unauthorized' }, { status: 404 })
    }

    // 2. Delete the transaction
    const { error: delErr } = await supabase
      .from('transactions')
      .delete()
      .eq('id', params.id)
      .eq('user_id', user.id)

    if (delErr) throw delErr

    // 3. Rebuild position from remaining transactions for that ticker
    await rebuildPosition(user.id, tx.ticker)

    // 4. Invalidate User Cache
    await invalidateUserCache(user.id)

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (err: any) {
    // Handle validation errors
    if (err.status === 400) {
      return validationErrorResponse(err)
    }
    
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
