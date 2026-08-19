import { createServiceClient } from './supabase-server'
import { normalizeError } from './errors'

/**
 * OPTIMISTIC LOCKING HELPER
 * 
 * Prevents race conditions when multiple requests try to update the same record.
 * 
 * HOW IT WORKS:
 * 1. Read current record + version
 * 2. Calculate new values with updateFn
 * 3. Try to UPDATE WHERE version = currentVersion AND user_id = userId
 * 4. If 0 rows updated → another writer won → RETRY
 * 5. After maxRetries → throw error
 * 
 * USE CASES:
 * - Multiple simultaneous cash deposits
 * - Concurrent transactions on same ticker
 * - High-frequency trading scenarios
 * 
 * PERFORMANCE:
 * - Optimistic locking is MUCH faster than pessimistic locks (SELECT FOR UPDATE)
 * - Only retries on actual conflicts (rare with low contention)
 * - No database locks held during calculation
 */

export interface OptimisticLockConfig {
  maxRetries?: number
  retryDelayMs?: number
}

export class OptimisticLockError extends Error {
  constructor(table: string, retries: number) {
    super(`Optimistic lock failed on ${table} after ${retries} retries. Too much contention.`)
    this.name = 'OptimisticLockError'
  }
}

/**
 * Update a record with optimistic locking.
 * 
 * @param table - Table name (cash_balance, on_positions, positions)
 * @param userId - User ID (for WHERE clause + security)
 * @param ticker - Ticker symbol (null for cash_balance)
 * @param updateFn - Function that calculates new values from current record
 * @param config - Configuration (maxRetries, retryDelayMs)
 * @returns Updated record after successful write
 * 
 * @example
 * ```typescript
 * const balance = await updateWithOptimisticLock(
 *   'cash_balance',
 *   userId,
 *   null,
 *   (current) => ({
 *     balance: current.balance + 100,
 *     updated_at: new Date().toISOString(),
 *   }),
 *   { maxRetries: 3 }
 * )
 * ```
 */
export async function updateWithOptimisticLock<T extends Record<string, any>>(
  table: string,
  userId: string,
  ticker: string | null,
  updateFn: (current: T) => Partial<T>,
  config: OptimisticLockConfig = {}
): Promise<T> {
  const { maxRetries = 3, retryDelayMs = 50 } = config
  const supabase = createServiceClient()

  let attempt = 0

  while (attempt < maxRetries) {
    attempt++

    const { data: current, error: readErr } = await (
      ticker !== null
        ? supabase.from(table).select('*').eq('user_id', userId).eq('ticker', ticker.toUpperCase().trim())
        : supabase.from(table).select('*').eq('user_id', userId)
    ).single()

    if (readErr) {
      throw new Error(`Record not found in ${table}. Use insert flow for first-time creation.`)
    }

    const currentVersion = current.version as number
    const updates = updateFn(current as T)

    let updateQuery = supabase
      .from(table)
      .update({
        ...updates,
        version: currentVersion + 1,
      })
      .eq('user_id', userId)
      .eq('version', currentVersion)

    if (ticker !== null) {
      updateQuery = updateQuery.eq('ticker', ticker.toUpperCase().trim())
    }

    const { data: updated, error: updateErr } = await updateQuery.select()

    if (updateErr) {
      throw normalizeError(updateErr)
    }

    if (!updated || updated.length === 0) {
      console.warn(
        `[Optimistic Lock] Conflict on ${table} (attempt ${attempt}/${maxRetries}). Retrying...`
      )

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs * Math.pow(2, attempt - 1)))
        continue
      } else {
        throw new OptimisticLockError(table, maxRetries)
      }
    }

    return updated[0] as T
  }

  // Should never reach here
  throw new OptimisticLockError(table, maxRetries)
}

/**
 * Check if optimistic locking is available on a table.
 * (Used for testing/debugging)
 */
export async function hasVersionColumn(table: string): Promise<boolean> {
  const supabase = createServiceClient()
  
  try {
    const { data, error } = await supabase
      .from(table)
      .select('version')
      .limit(1)
    
    return !error
  } catch {
    return false
  }
}