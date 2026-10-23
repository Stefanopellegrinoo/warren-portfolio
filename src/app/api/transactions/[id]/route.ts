import { NextRequest, NextResponse } from 'next/server'
import { invalidateUserCache } from '@/lib/redis'
import { UUIDSchema } from '@/lib/schemas/common'
import { validateBody, validationErrorResponse } from '@/lib/api/validation'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { normalizeError } from '@/lib/errors'
import { buildCashMovementForTransaction, signedQuantity } from '@/lib/transaction-cash'
import { recordCedearTrade, TradeRecordError } from '@/lib/trade-record'
import { CedearTradeSchema } from '@/lib/schemas/transaction'
import { assertNoNewOversell } from '@/lib/ledger-write'

export const dynamic = 'force-dynamic'

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const authResult = await requireUser()
    if (isAuthFailure(authResult)) return authResult.error
    const { supabase, user } = authResult

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

    // 2. The core's sale rule: removing a buy must not leave a later sale selling more than held
    await assertNoNewOversell(supabase, user.id, rows => rows.filter(r => r.id !== params.id))

    // 3. Delete the transaction. The ledger IS the state (T5.1): nothing to rebuild.
    // NOTE: Associated cash_movement (if exists) is deleted automatically via ON DELETE CASCADE
    const { error: delErr } = await supabase
      .from('transactions')
      .delete()
      .eq('id', params.id)
      .eq('user_id', user.id)

    if (delErr) throw normalizeError(delErr)

    // 4. Invalidate User Cache
    await invalidateUserCache(user.id)

    // 5. Force frontend to refresh portfolio data
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
    const authResult = await requireUser()
    if (isAuthFailure(authResult)) return authResult.error
    const { supabase, user } = authResult

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

    // 2. Validate the update payload. A CEDEAR broker ticket (`tradeCurrency`)
    //    is re-derived on the server like a new one and replaces the trade
    //    record, which also settles a pending review. Otherwise by asset type.
    const raw = await req.json()
    let fields: Record<string, unknown>
    if (raw && typeof raw === 'object' && 'tradeCurrency' in raw) {
      const t = await recordCedearTrade(supabase, validateBody(CedearTradeSchema, { ...raw, ticker: originalTx.ticker }))
      const r = t.tradeRecord
      fields = {
        date: t.date,
        operation: t.operation,
        quantity: signedQuantity(t.operation, t.quantity),
        price: t.price,
        commission: t.commission ?? 0,
        notes: t.notes || null,
        trade_currency: r.tradeCurrency, trade_quantity: r.tradeQuantity, trade_price: r.tradePrice,
        trade_commission: r.tradeCommission, cedear_ratio: r.cedearRatio, fx_mep: r.fxMep, fx_ccl: r.fxCcl,
        fx_date: r.fxDate, fx_source: r.fxSource, needs_review: false, review_note: null,
      }
    } else {
      let validatedBody
      if (originalTx.asset_type === 'ON') {
        const { ONTransactionSchema } = await import('@/lib/schemas/on')
        validatedBody = validateBody(ONTransactionSchema, raw)
      } else {
        const { TransactionSchema } = await import('@/lib/schemas/transaction')
        validatedBody = validateBody(TransactionSchema, raw)
      }
      fields = {
        date: validatedBody.date,
        operation: validatedBody.operation,
        quantity: signedQuantity(validatedBody.operation, validatedBody.quantity),
        price: validatedBody.price,
        commission: validatedBody.commission || 0,
        notes: validatedBody.notes || null,
      }
    }

    // 3. The core's sale rule on the ledger with this row edited
    await assertNoNewOversell(supabase, user.id, rows => rows.map(r => (r.id === params.id ? { ...r, ...fields } as typeof r : r)))

    // 4. Update the transaction — VENTA keeps the RPC's -ABS(qty) convention
    const { data: updated, error: updateErr } = await supabase
      .from('transactions')
      .update(fields)
      .eq('id', params.id)
      .select()
      .single()

    if (updateErr) throw normalizeError(updateErr)

    // 5. Delete old cash_movement (if exists) before recreating it
    // This handles cases where transaction was edited (different amount/operation)
    await supabase
      .from('cash_movements')
      .delete()
      .eq('transaction_id', params.id)

    // 6. Recreate the cash movement with the SAME contract the RPC uses:
    //    type = the operation itself and transaction_id kept linked. Routing
    //    this through processCashMovement as RETIRO/DEPOSITO wrote a movement
    //    with transaction_id = NULL — a forged external flow that distorted
    //    the flow-adjusted max drawdown on every edit. It also dropped the
    //    movement entirely when the operation became DIVIDENDO.
    const movement = buildCashMovementForTransaction(updated)
    if (movement) {
      const { error: movementErr } = await supabase.from('cash_movements').insert({
        user_id: user.id,
        date: updated.date,
        type: movement.type,
        amount: movement.amount,
        description: `${updated.operation} ${originalTx.ticker} - ${Math.abs(updated.quantity)} @ ${updated.price}`,
        ticker: originalTx.ticker,
        transaction_id: params.id,
      })
      if (movementErr) throw normalizeError(movementErr)
    }

    // 7. Invalidate User Cache. The ledger IS the state (T5.1): nothing to rebuild.
    await invalidateUserCache(user.id)

    return NextResponse.json({ success: true, data: updated }, { status: 200 })
  } catch (err: any) {
    if (err instanceof TradeRecordError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    // Handle validation errors
    if (err.status === 400) {
      return validationErrorResponse(err)
    }

    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
