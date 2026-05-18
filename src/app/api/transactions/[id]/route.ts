import { NextRequest, NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { rebuildPosition } from '@/lib/portfolio-engine'
import { invalidateUserCache } from '@/lib/redis'
import { UUIDSchema } from '@/lib/schemas/common'
import { validateRequest, validationErrorResponse } from '@/lib/api/validation'

export const dynamic = 'force-dynamic'

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createServerClientInstance()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Validate UUID
    try {
      UUIDSchema.parse(params.id)
    } catch (error: any) {
      return NextResponse.json(
        { error: 'Invalid transaction ID', details: error.errors },
        { status: 400 }
      )
    }

    // 1. Get the transaction to know the ticker AND asset type
    const { data: tx, error: getErr } = await supabase
      .from('transactions')
      .select('ticker, asset_type')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()

    if (getErr || !tx) {
      return NextResponse.json({ error: 'Transaction not found or unauthorized' }, { status: 404 })
    }

    // 2. Delete the transaction
    // NOTE: Associated cash_movement (if exists) is deleted automatically via ON DELETE CASCADE
    const { error: delErr } = await supabase
      .from('transactions')
      .delete()
      .eq('id', params.id)
      .eq('user_id', user.id)

    if (delErr) throw delErr

    // 3. Rebuild position using correct function based on asset type
    if (tx.asset_type === 'ON') {
      const { rebuildONPosition } = await import('@/lib/on-engine')
      await rebuildONPosition(supabase, user.id, tx.ticker)
    } else {
      await rebuildPosition(supabase, user.id, tx.ticker)
    }

    // 4. Rebuild cash balance to ensure consistency after deletion
    const { rebuildCashBalance } = await import('@/lib/cash-engine')
    await rebuildCashBalance(supabase, user.id)

    // 5. Invalidate User Cache
    await invalidateUserCache(user.id)

    // 6. Force frontend to refresh portfolio data
    // Add a timestamp to ensure cache invalidation in the browser
    const timestamp = Date.now()
    
    return NextResponse.json({ 
      success: true, 
      invalidated: timestamp,
      message: 'Transaction deleted. Portfolio and cash balance recalculated.'
    }, { status: 200 })
  } catch (err: any) {
    // Handle validation errors
    if (err.status === 400) {
      return validationErrorResponse(err)
    }
    
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createServerClientInstance()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Validate UUID
    try {
      UUIDSchema.parse(params.id)
    } catch (error: any) {
      return NextResponse.json(
        { error: 'Invalid transaction ID', details: error.errors },
        { status: 400 }
      )
    }

    // 1. Get the original transaction to know ticker and asset_type
    const { data: originalTx, error: getErr } = await supabase
      .from('transactions')
      .select('ticker, asset_type')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()

    if (getErr || !originalTx) {
      return NextResponse.json({ error: 'Transaction not found or unauthorized' }, { status: 404 })
    }

    // 2. Validate the update payload based on asset type
    let validatedBody
    if (originalTx.asset_type === 'ON') {
      const { ONTransactionSchema } = await import('@/lib/schemas/on')
      validatedBody = await validateRequest(ONTransactionSchema, req)
    } else {
      const { TransactionSchema } = await import('@/lib/schemas/transaction')
      validatedBody = await validateRequest(TransactionSchema, req)
    }

    // 3. Update the transaction
    const { data: updated, error: updateErr } = await supabase
      .from('transactions')
      .update({
        date: validatedBody.date,
        operation: validatedBody.operation,
        quantity: validatedBody.quantity,
        price: validatedBody.price,
        commission: validatedBody.commission || 0,
        notes: validatedBody.notes || null,
      })
      .eq('id', params.id)
      .select()
      .single()

    if (updateErr) throw updateErr

    // 4. Delete old cash_movement (if exists) before rebuild
    // This handles cases where transaction was edited (different amount/operation)
    await supabase
      .from('cash_movements')
      .delete()
      .eq('transaction_id', params.id)

    // 5. Recreate cash_movement with updated values (for COMPRA/VENTA only)
    if (updated.operation === 'COMPRA' || updated.operation === 'VENTA') {
      const { processCashMovement } = await import('@/lib/cash-engine')
      const transactionCost = (Math.abs(updated.quantity) * updated.price) + (updated.commission || 0)
      
      try {
        await processCashMovement(supabase, user.id, {
          date: updated.date,
          type: updated.operation === 'COMPRA' ? 'RETIRO' : 'DEPOSITO',
          amount: updated.operation === 'COMPRA' ? transactionCost : (Math.abs(updated.quantity) * updated.price) - (updated.commission || 0),
          description: `${updated.operation} ${originalTx.ticker} - ${Math.abs(updated.quantity)} @ ${updated.price}`,
          ticker: originalTx.ticker,
          transaction_id: params.id,
        })
      } catch (cashError) {
        console.error('[PATCH Transaction] Failed to recreate cash movement:', cashError)
      }
    }

    // 6. Rebuild position using correct function
    if (originalTx.asset_type === 'ON') {
      const { rebuildONPosition } = await import('@/lib/on-engine')
      await rebuildONPosition(supabase, user.id, originalTx.ticker)
    } else {
      await rebuildPosition(supabase, user.id, originalTx.ticker)
    }

    // 7. Rebuild cash balance from the ledger — step 4 only removes the cash_movement row,
    //    it does NOT reverse the cash_balance delta that was already applied by the original RPC.
    //    Without this rebuild, the balance accumulates both the old and new deltas.
    const { rebuildCashBalance } = await import('@/lib/cash-engine')
    await rebuildCashBalance(supabase, user.id)

    // 8. Invalidate User Cache
    await invalidateUserCache(user.id)

    return NextResponse.json({ success: true, data: updated }, { status: 200 })
  } catch (err: any) {
    // Handle validation errors
    if (err.status === 400) {
      return validationErrorResponse(err)
    }
    
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
