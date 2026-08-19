import type { CashBalance, CashMovement, CashMovementInput } from '@/types'
import { getRedis, isRedisReady, invalidateUserCache, SUMMARY_VERSION_TTL } from './redis'
import { invalidateCacheKey } from './cache'
import { normalizeError } from './errors'
import { addRefreshSummaryJob } from './queue'
import { cashDelta } from './cash-signs'
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
    throw normalizeError(rpcErr)
  }

  // 2. Fetch results
  const [movementRes, balanceRes] = await Promise.all([
    supabase.from('cash_movements').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).single(),
    supabase.from('cash_balance').select('*').eq('user_id', userId).single()
  ])

  // 3. Invalidate Redis cache
  await invalidateUserCache(userId)

  // 4. Trigger an on-demand summary refresh so the dashboard updates immediately
  try {
    await addRefreshSummaryJob(userId)
  } catch (err) {
    console.warn('[Cash Engine] Failed to enqueue summary refresh:', err)
  }

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
  
  if (fetchErr) throw normalizeError(fetchErr)
  
  let balance = 0

  for (const m of movements ?? []) {
    balance += cashDelta(m.type, m.amount)
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
  
  if (upsertErr) throw normalizeError(upsertErr)
  
  // Invalidate Redis cache for portfolio summary
  if (isRedisReady()) {
    try { 
      const redis = getRedis()
      // Bump version before deleting summary so the worker can detect stale writes
      await Promise.all([
        redis?.incr(`summary:version:${userId}`),
        redis?.expire(`summary:version:${userId}`, SUMMARY_VERSION_TTL),
      ])
      await Promise.all([
        redis?.del(`summary:${userId}`),
        invalidateCacheKey(`cash:balance:${userId}`), // Invalidate cached balance
      ])
    } catch (err) {
      console.warn('[Cash Engine] Failed to invalidate Redis cache:', err)
    }
  }

  // Trigger an on-demand summary refresh so the dashboard updates immediately
  try {
    await addRefreshSummaryJob(userId)
  } catch (err) {
    console.warn('[Cash Engine] Failed to enqueue summary refresh:', err)
  }
  
  return updatedBalance
}

/** Money is stored as numeric(18,4); keep replayed floats on that grid. */
const CENTS_GRID = 10_000
/** Below this the difference is float replay noise, not a real discrepancy. */
const NEGLIGIBLE = 0.0001

function roundMoney(value: number): number {
  return Math.round(value * CENTS_GRID) / CENTS_GRID
}

export interface CashAdjustment {
  /** The movement written to close the gap, or null when nothing was needed. */
  movement: CashMovement | null
  balance: CashBalance
  /** Signed difference applied: target minus what the ledger said. */
  delta: number
}

/**
 * Reconciles the ledger to a known real-world cash balance.
 *
 * An imported transaction history contains buys but not the deposits that
 * funded them, so `rebuildCashBalance` legitimately lands on a large negative
 * number. Asking the user to remember months-old deposits does not work; asking
 * for today's balance does. This writes the single movement that closes the
 * gap, instead of inventing a deposit history.
 *
 * The movement carries no `transaction_id`, which is exactly what marks it as
 * external capital for the flow-adjusted drawdown. Date it at the start of the
 * history (before the first snapshot) when reconciling an import, so it is
 * treated as an opening balance rather than a deposit that moves the metric.
 */
export async function adjustCashBalance(
  supabase: SupabaseClient,
  userId: string,
  targetBalance: number,
  date: string,
  description?: string
): Promise<CashAdjustment> {
  assertUserId(userId)

  if (typeof targetBalance !== 'number' || !Number.isFinite(targetBalance)) {
    throw new Error('Target balance must be a finite number')
  }

  // Recompute from the ledger first: the stored balance could be stale, and an
  // adjustment built on a stale figure would silently land on the wrong number.
  const current = await rebuildCashBalance(supabase, userId)
  const delta = roundMoney(targetBalance - Number(current.balance))

  if (Math.abs(delta) < NEGLIGIBLE) {
    return { movement: null, balance: current, delta: 0 }
  }

  const { data: movement, error } = await supabase
    .from('cash_movements')
    .insert({
      user_id: userId,
      date,
      type: delta > 0 ? 'DEPOSITO' : 'RETIRO',
      amount: Math.abs(delta),
      description: description ?? `Ajuste de saldo a ${roundMoney(targetBalance)}`,
      transaction_id: null,
    })
    .select()
    .single()

  if (error) throw normalizeError(error)

  const balance = await rebuildCashBalance(supabase, userId)

  // Post-condition: the ledger must now replay to the requested figure. If it
  // does not, another write landed between the read and the insert and the
  // adjustment is off — say so loudly rather than let a wrong balance stand.
  const achieved = Number(balance.balance)
  if (Math.abs(achieved - targetBalance) >= NEGLIGIBLE) {
    console.error(
      `[Cash Engine] Adjustment for ${userId} landed on ${achieved}, expected ${targetBalance} — concurrent write?`
    )
  }

  return { movement, balance, delta }
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
 * Thrown when trying to delete a movement that belongs to a transaction —
 * the transaction would keep existing while its cash leg vanishes, a
 * permanent desync no rebuild can repair (the movement IS the record).
 */
export class LinkedMovementError extends Error {
  constructor() {
    super(
      'Este movimiento fue generado por una transacción. Eliminá o editá la transacción — su movimiento de caja se actualiza solo.'
    )
    this.name = 'LinkedMovementError'
  }
}

/**
 * Delete a MANUAL cash movement and recalculate balance.
 * Transaction-linked movements are refused — see LinkedMovementError.
 */
export async function deleteCashMovement(
  supabase: SupabaseClient,
  userId: string,
  movementId: string
): Promise<CashBalance> {
  assertUserId(userId)

  // 0. Guard: only movements with no source transaction may be deleted here.
  const { data: movement, error: fetchErr } = await supabase
    .from('cash_movements')
    .select('id, transaction_id')
    .eq('id', movementId)
    .eq('user_id', userId)
    .maybeSingle()

  if (fetchErr) throw normalizeError(fetchErr)
  if (!movement) throw new Error('Movimiento no encontrado')
  if (movement.transaction_id) throw new LinkedMovementError()

  // 1. Delete the movement
  const { error: deleteErr } = await supabase
    .from('cash_movements')
    .delete()
    .eq('id', movementId)
    .eq('user_id', userId)

  if (deleteErr) throw normalizeError(deleteErr)

  // 2. Rebuild balance from remaining movements
  return await rebuildCashBalance(supabase, userId)
}
