import type { CashBalance, CashMovement, CashMovementInput } from '@/types'
import { getRedis, isRedisReady, invalidateUserCache } from './redis'
import { invalidateCacheKey } from './cache'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * SECURITY: Explicitly validate userId to prevent data corruption.
 */
function assertUserId(userId: unknown): asserts userId is string {
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    throw new Error(
      '[Security] userId inválido o ausente. Operación cancelada para prevenir corrupción de datos.'
    )
  }
}

/**
 * CASH ENGINE
 * 
 * Manages cash balance operations:
 * - DEPOSITO: adds to balance
 * - RETIRO: subtracts from balance
 * - CUPON: adds coupon payment (from ONs)
 * - DIVIDENDO: adds dividend payment (from stocks)
 * 
 * Strategy: ATOMIC SQL RPC (Postgres)
 */

/**
 * Process a new cash movement and update balance.
 * 
 * CONCURRENCY STRATEGY:
 * - Uses ATOMIC SQL RPC (fast path & consistency guaranteed)
 * 
 * Returns the created movement and updated balance.
 */
export async function processCashMovement(
  supabase: SupabaseClient,
  userId: string,
  input: CashMovementInput
): Promise<{ movement: CashMovement; balance: CashBalance }> {
  assertUserId(userId)
  
  // 1. Call the atomic RPC to handle everything in one DB transaction
  const { data, error: rpcErr } = await supabase.rpc('process_transaction_atomic', {
    p_date: input.date,
    p_operation: input.type,
    p_price: input.amount, // For DEPOSITO/RETIRO, p_price is used as the amount
    p_notes: input.description ?? null,
    p_ticker: input.ticker ?? null,
    p_user_id: userId
  })

  if (rpcErr) {
    console.error('[Cash Engine] RPC Error:', rpcErr)
    throw rpcErr
  }

  // 2. Fetch results
  const [movementRes, balanceRes] = await Promise.all([
    supabase.from('cash_movements').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).single(),
    supabase.from('cash_balance').select('*').eq('user_id', userId).single()
  ])

  // 3. Invalidate Redis cache
  await invalidateUserCache(userId)

  return { movement: movementRes.data, balance: balanceRes.data }
}

/**
 * Rebuild cash balance from all movements.
 * 
 * This is the source of truth — balance is always derived from movements.
 */
export async function rebuildCashBalance(
  supabase: SupabaseClient,
  userId: string
): Promise<CashBalance> {
  assertUserId(userId)
  
  // Fetch all movements in chronological order
  const { data: movements, error: fetchErr } = await supabase
    .from('cash_movements')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: true })
    .order('created_at', { ascending: true })
  
  if (fetchErr) throw fetchErr
  
  let balance = 0

  for (const m of movements ?? []) {
    switch (m.type) {
      case 'DEPOSITO':
      case 'CUPON':
      case 'DIVIDENDO':
      case 'VENTA':
        balance += m.amount
        break
      case 'RETIRO':
      case 'COMPRA':
        balance -= m.amount
        break
    }
  }
  
  // Upsert the calculated balance
  const { data: updatedBalance, error: upsertErr } = await supabase
    .from('cash_balance')
    .upsert({
      user_id: userId,
      balance,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select()
    .single()
  
  if (upsertErr) throw upsertErr
  
  // Invalidate Redis cache for portfolio summary
  if (isRedisReady()) {
    try { 
      await Promise.all([
        getRedis()?.del(`summary:${userId}`),
        invalidateCacheKey(`cash:balance:${userId}`), // Invalidate cached balance
      ])
    } catch (err) {
      console.warn('[Cash Engine] Failed to invalidate Redis cache:', err)
    }
  }
  
  return updatedBalance
}

/**
 * Get current cash balance for a user.
 */
export async function getCashBalance(
  supabase: SupabaseClient,
  userId: string
): Promise<CashBalance | null> {
  assertUserId(userId)

  const { data, error } = await supabase
    .from('cash_balance')
    .select('*')
    .eq('user_id', userId)
    .single()
  
  if (error) {
    return null
  }
  
  return data
}

/**
 * Delete a cash movement and recalculate balance.
 */
export async function deleteCashMovement(
  supabase: SupabaseClient,
  userId: string,
  movementId: string
): Promise<CashBalance> {
  assertUserId(userId)

  // 1. Delete the movement
  const { error: deleteErr } = await supabase
    .from('cash_movements')
    .delete()
    .eq('id', movementId)
    .eq('user_id', userId) 

  if (deleteErr) throw deleteErr

  // 2. Rebuild balance from remaining movements
  return await rebuildCashBalance(supabase, userId)
}
