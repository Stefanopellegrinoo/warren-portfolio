import type { CashBalance, CashMovement, CashMovementInput } from '@/types'
import { invalidateUserCache } from './redis'
import { normalizeError } from './errors'
import { addRefreshSummaryJob } from './queue'
import { loadPortfolioNow } from './ledger-now'
import { argentinaDate } from './utils'
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

/** The cash the screens show: the ledger core's (movements plus automatic ON payments). */
export type LedgerCash = Pick<CashBalance, 'user_id' | 'balance'>

async function ledgerCash(supabase: SupabaseClient, userId: string): Promise<LedgerCash> {
  const { cashBalance } = await loadPortfolioNow(supabase, userId, argentinaDate())
  return { user_id: userId, balance: cashBalance }
}

/** Manual cash movements. No CUPON: ON coupons are automatic (odd/tasks/nucleo-ledger.md S4, S10). */
const MANUAL_TYPES = new Set(['DEPOSITO', 'RETIRO', 'DIVIDENDO'])

/**
 * CASH ENGINE (odd/tasks/nucleo-ledger.md T5.1, S5): writes cash_movements rows only; the
 * balance is always the ledger core's, never a stored one.
 * - DEPOSITO: adds to balance
 * - RETIRO: subtracts from balance
 * - DIVIDENDO: adds dividend income (from stocks)
 */

/**
 * Record a manual cash movement through the RPC and answer the movement and the ledger cash.
 */
export async function processCashMovement(
  supabase: SupabaseClient,
  userId: string,
  input: CashMovementInput
): Promise<{ movement: CashMovement; balance: LedgerCash }> {
  assertUserId(userId)
  if (!MANUAL_TYPES.has(input.type)) {
    throw Object.assign(new Error('Tipo de movimiento inválido: usá DEPOSITO, RETIRO o DIVIDENDO.'), { status: 400 })
  }

  // DIVIDENDO without quantity is a cash-only income of p_price (migration 046).
  const { error: rpcErr } = await supabase.rpc('process_transaction_atomic', {
    p_date: input.date,
    p_operation: input.type,
    p_price: input.amount, // the amount of a manual movement
    p_notes: input.description ?? null,
    p_ticker: input.ticker ?? null,
    p_user_id: userId
  })

  if (rpcErr) {
    console.error('[Cash Engine] RPC Error:', rpcErr)
    throw normalizeError(rpcErr)
  }

  const movementRes = await supabase.from('cash_movements').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).single()
  if (movementRes.error) throw normalizeError(movementRes.error)
  const balance = await ledgerCash(supabase, userId)

  await invalidateUserCache(userId)

  // Trigger an on-demand summary refresh so the dashboard updates immediately
  try {
    await addRefreshSummaryJob(userId)
  } catch (err) {
    console.warn('[Cash Engine] Failed to enqueue summary refresh:', err)
  }

  return { movement: movementRes.data, balance }
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
  balance: LedgerCash
  /** Signed difference applied: target minus what the ledger said. */
  delta: number
}

/**
 * Reconciles the ledger to a known real-world cash balance.
 *
 * An imported transaction history contains buys but not the deposits that
 * funded them, so the ledger cash legitimately lands on a large negative
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

  // The gap is measured against the ledger core's cash: the figure the screens show.
  const current = await ledgerCash(supabase, userId)
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

  const balance = await ledgerCash(supabase, userId)

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
 * Delete a MANUAL cash movement. Transaction-linked movements are refused — see LinkedMovementError.
 * The balance is the ledger's, so there is nothing else to update.
 */
export async function deleteCashMovement(
  supabase: SupabaseClient,
  userId: string,
  movementId: string
): Promise<void> {
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

  const { error: deleteErr } = await supabase
    .from('cash_movements')
    .delete()
    .eq('id', movementId)
    .eq('user_id', userId)

  if (deleteErr) throw normalizeError(deleteErr)
}
