import type { ONPosition, ONClosedTrade, ONOperation } from '@/types'
import { getRedis, isRedisReady, invalidateUserCache } from './redis'
import { normalizeError } from './errors'
import { createServiceClient } from './supabase-server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertNoNewOversell, pendingTrade, stateAfterWrite } from './ledger-write'

export interface ONTransactionInput {
  date: string
  ticker: string
  // No CUPON: coupons and amortizations come from the bond schedule (odd/tasks/nucleo-ledger.md S4, S10).
  operation: ONOperation
  quantity: number
  price: number
  commission?: number
  notes?: string
}

/** S10: refused here as well as in the schemas, so no caller can book a manual coupon. */
export const MANUAL_COUPON_ERROR = 'Los cupones de las ONs se calculan solos: corregí un pago en ONs → Mi cartera.'

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
 * Process an ON (Obligación Negociable) trade (odd/tasks/nucleo-ledger.md T5.1, S5): a sale is
 * validated by the ledger core, the RPC inserts the ledger rows only, and the position and
 * the sale come back from the core.
 */
export async function processONTransaction(
  supabase: SupabaseClient,
  userId: string,
  input: ONTransactionInput
): Promise<{ position: ONPosition | null; closedTrade: ONClosedTrade | null }> {
  assertUserId(userId)

  if (input.operation !== 'COMPRA' && input.operation !== 'VENTA') {
    throw Object.assign(new Error(MANUAL_COUPON_ERROR), { status: 400 })
  }

  // 0. Check for background import lock
  if (isRedisReady()) {
    const redis = getRedis()
    const isImporting = await redis?.get(`importing:${userId}`)
    if (isImporting) {
      throw new Error('Hay una importación masiva en curso para este usuario. Por favor, espere a que finalice para realizar cambios manuales.')
    }
  }

  const ticker = input.ticker.toUpperCase().trim()

  // Validation: ON tickers MUST end with 'D' (Dollar-MEP bonds only)
  if (!ticker.endsWith('D')) {
    throw new Error(`ON tickers must end with 'D' for Dollar-MEP bonds. '${ticker}' is invalid.`)
  }

  if (input.operation === 'VENTA') {
    const pending = pendingTrade({ ...input, ticker, assetType: 'ON' })
    await assertNoNewOversell(supabase, userId, rows => [...rows, pending])
  }

  // 0.5. Auto-discover: ensure ticker exists in ons catalog
  // Uses service client to bypass RLS (ons table only allows service_role writes)
  try {
    const serviceClient = createServiceClient()
    await serviceClient
      .from('ons')
      .upsert({ ticker, currency: 'USD', created_at: new Date().toISOString() }, { onConflict: 'ticker' })
  } catch (err) {
    // Non-critical — the background worker also handles this via updateONPricesInDatabase
    console.warn(`[ON Engine] Failed to register ticker ${ticker} in ons catalog:`, err)
  }

  // 1. Insert the ledger rows
  const { error: rpcErr } = await supabase.rpc('process_transaction_atomic', {
    p_date: input.date,
    p_ticker: ticker,
    p_operation: input.operation,
    p_quantity: Math.abs(input.quantity),
    p_price: input.price,
    p_commission: input.commission ?? 0,
    p_notes: input.notes ?? null,
    p_asset_type: 'ON',
    p_moneda: 'USD',
    p_user_id: userId
  })
  if (rpcErr) {
    console.error('[ON Engine] RPC Error:', rpcErr)
    throw normalizeError(rpcErr)
  }

  // 2. The position and the sale, from the core
  const { position, closedTrade } = await stateAfterWrite(supabase, userId, ticker, 'ON', input.operation === 'VENTA')

  // 3. Fetch current ON price immediately + enqueue reliable worker job (runs outside market hours too)
  try {
    const { fetchONQuotesWithFallback } = await import('./data912-client')
    console.log(`[ON Engine] Warming up price for ${ticker}...`)
    await fetchONQuotesWithFallback([ticker])
  } catch (priceError) {
    console.warn(`[ON Engine] Failed to warm up price for ${ticker}:`, priceError)
  }
  try {
    const { addPriceUpdateJob } = await import('./queue')
    await addPriceUpdateJob([ticker])
  } catch (queueErr) {
    console.warn(`[ON Engine] Failed to enqueue price update for ${ticker}:`, queueErr)
  }

  // 4. Invalidate Redis cache
  await invalidateUserCache(userId)

  return { position, closedTrade }
}
