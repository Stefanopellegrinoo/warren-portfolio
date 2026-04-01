import { createServiceClient } from './supabase-server'
import type { CashBalance, CashMovement, CashMovementInput } from '@/types'
import { getRedis, isRedisReady } from './redis'
import { updateWithOptimisticLock } from './concurrency'
import { cached, CacheTTL, invalidateCacheKey } from './cache'

/**
 * CASH ENGINE
 * 
 * Manages cash balance operations:
 * - DEPOSITO: adds to balance
 * - RETIRO: subtracts from balance
 * - CUPON: adds coupon payment (from ONs)
 * - DIVIDENDO: adds dividend payment (from stocks)
 * 
 * Strategy: Rebuild balance from scratch after every change.
 * This ensures consistency and allows auditing the full cash history.
 */

/**
 * Process a new cash movement and update balance.
 * 
 * CONCURRENCY STRATEGY:
 * - Uses OPTIMISTIC LOCKING to prevent race conditions
 * - If balance record doesn't exist yet, falls back to rebuildCashBalance (creates it)
 * - If optimistic lock fails after retries, falls back to rebuildCashBalance (last resort)
 * 
 * Returns the created movement and updated balance.
 */
export async function processCashMovement(
  userId: string,
  input: CashMovementInput
): Promise<{ movement: CashMovement; balance: CashBalance }> {
  const supabase = createServiceClient()
  
  // 1. Insert movement
  const { data: newMovement, error: insertErr } = await supabase
    .from('cash_movements')
    .insert({
      user_id: userId,
      date: input.date,
      type: input.type,
      amount: input.amount,
      description: input.description ?? null,
      ticker: input.ticker ?? null,
    })
    .select()
    .single()
  
  if (insertErr) throw insertErr
  
  // 2. Update balance with optimistic locking
  try {
    const balance = await updateWithOptimisticLock<CashBalance>(
      'cash_balance',
      userId,
      null, // no ticker for cash_balance
      (currentBalance) => {
        // Calculate the delta from this movement
        let delta = 0
        if (input.type === 'DEPOSITO' || input.type === 'CUPON' || input.type === 'DIVIDENDO') {
          delta = input.amount
        } else if (input.type === 'RETIRO') {
          delta = -input.amount
        }

        return {
          balance: currentBalance.balance + delta,
          updated_at: new Date().toISOString(),
        }
      },
      { maxRetries: 3 }
    )

    // Invalidate Redis cache
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

    return { movement: newMovement, balance }
    
  } catch (error) {
    // FALLBACK: If optimistic lock fails OR record doesn't exist yet
    // Fall back to rebuildCashBalance (creates record if needed)
    console.warn('[Cash Engine] Optimistic lock failed, falling back to rebuildCashBalance:', error)
    const balance = await rebuildCashBalance(userId)
    return { movement: newMovement, balance }
  }
}

/**
 * Rebuild cash balance from all movements.
 * 
 * This is the source of truth — balance is always derived from movements.
 * 
 * WHEN TO USE:
 * - Data initialization (first cash movement for a user)
 * - Data correction (when balance is inconsistent)
 * - Batch operations (imports, migrations)
 * - FALLBACK when optimistic locking fails (too much contention)
 * 
 * WHEN NOT TO USE:
 * - Normal concurrent operations (use processCashMovement with optimistic locking instead)
 */
export async function rebuildCashBalance(userId: string): Promise<CashBalance> {
  const supabase = createServiceClient()
  
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
    if (m.type === 'DEPOSITO' || m.type === 'CUPON' || m.type === 'DIVIDENDO') {
      balance += m.amount
    } else if (m.type === 'RETIRO') {
      balance -= m.amount
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
 * Returns null if no balance exists (user hasn't made any cash movements yet).
 * 
 * PERFORMANCE: Cached for 30 seconds to reduce DB load on dashboard.
 */
export async function getCashBalance(userId: string): Promise<CashBalance | null> {
  return cached(
    `cash:balance:${userId}`,
    CacheTTL.CASH_BALANCE,
    async () => {
      const supabase = createServiceClient()
      
      const { data, error } = await supabase
        .from('cash_balance')
        .select('*')
        .eq('user_id', userId)
        .single()
      
      if (error) {
        // No balance found — return null (user starts with $0)
        return null
      }
      
      return data
    }
  )
}

/**
 * Delete a cash movement and recalculate balance.
 * Used when correcting data entry mistakes.
 */
export async function deleteCashMovement(
  userId: string,
  movementId: string
): Promise<CashBalance> {
  const supabase = createServiceClient()

  // 1. Delete the movement
  const { error: deleteErr } = await supabase
    .from('cash_movements')
    .delete()
    .eq('id', movementId)
    .eq('user_id', userId) // Security: ensure user owns the movement

  if (deleteErr) throw deleteErr

  // 2. Rebuild balance from remaining movements
  return await rebuildCashBalance(userId)
}
