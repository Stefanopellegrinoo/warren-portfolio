import type { ONPosition, ONClosedTrade, ONOperation } from '@/types'
import { getRedis, isRedisReady } from './redis'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ONTransactionInput {
  date: string
  ticker: string
  operation: ONOperation
  quantity: number
  price: number
  commission?: number
  notes?: string
}

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
 * Process an ON (Obligación Negociable) transaction:
 * - COMPRA/VENTA: uses process_transaction_atomic RPC
 * 
 * CONCURRENCY STRATEGY:
 * - Uses ATOMIC SQL RPC (fast path & consistency guaranteed)
 */
export async function processONTransaction(
  supabase: SupabaseClient,
  userId: string,
  input: ONTransactionInput
): Promise<{ position: ONPosition | null; closedTrade: ONClosedTrade | null }> {
  assertUserId(userId)
  
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
  
  // 1. Call the atomic RPC — retry up to 3× on concurrent modification conflicts
  const RPC_MAX_RETRIES = 3
  for (let attempt = 1; attempt <= RPC_MAX_RETRIES; attempt++) {
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

    if (!rpcErr) break

    const isConcurrentConflict = rpcErr.message?.includes('Concurrent modification')
    if (isConcurrentConflict && attempt < RPC_MAX_RETRIES) {
      console.warn(`[ON Engine] Concurrent modification — retrying (${attempt}/${RPC_MAX_RETRIES})`)
      await new Promise(r => setTimeout(r, 50 * Math.pow(2, attempt - 1)))
      continue
    }

    console.error('[ON Engine] RPC Error:', rpcErr)
    throw rpcErr
  }

  // 2. Fetch results to return
  const [posRes, ctRes] = await Promise.all([
    supabase.from('on_positions').select('*').eq('user_id', userId).eq('ticker', ticker).single(),
    input.operation === 'VENTA' 
      ? supabase.from('on_closed_trades').select('*').eq('user_id', userId).eq('ticker', ticker).order('close_date', { ascending: false }).limit(1).single()
      : Promise.resolve({ data: null })
  ])

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
  if (isRedisReady()) {
    try { await getRedis()?.del(`summary:${userId}`) } catch {}
  }

  return { position: posRes.data ?? null, closedTrade: ctRes.data ?? null }
}

/**
 * Recalculate ON closed trades for a ticker using incremental UPSERT.
 */
export async function rebuildONClosedTrades(
  supabase: SupabaseClient,
  userId: string,
  ticker: string
) {
  assertUserId(userId)
  const normalizedTicker = ticker.toUpperCase().trim()

  const { data: allTx, error: fetchErr } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .eq('ticker', normalizedTicker)
    .eq('asset_type', 'ON')
    .order('date', { ascending: true })
    .order('created_at', { ascending: true })

  if (fetchErr) throw fetchErr
  if (!allTx || allTx.length === 0) {
    await supabase.from('on_closed_trades').delete().eq('user_id', userId).eq('ticker', normalizedTicker)
    return
  }

  let quantity = 0
  let costBasis = 0
  let firstBought: string | null = null
  let avgCost = 0
  const closedTradeRows: any[] = []

  for (const tx of allTx) {
    const qty = Math.abs(tx.quantity)

    if (tx.operation === 'COMPRA') {
      if (quantity === 0) firstBought = tx.date
      costBasis += qty * tx.price + (tx.commission || 0)
      quantity += qty
      avgCost = costBasis / quantity
    } else if (tx.operation === 'VENTA') {
      if (quantity > 0) {
        const sellQty = Math.min(qty, quantity)
        const proceeds = sellQty * tx.price - (tx.commission || 0)
        closedTradeRows.push({
          user_id: userId,
          ticker: normalizedTicker,
          open_date: firstBought || tx.date,
          close_date: tx.date,
          avg_cost: avgCost,
          close_price: tx.price,
          quantity: sellQty,
          invested: sellQty * avgCost,
          proceeds,
          transaction_id: tx.id
        })
        costBasis -= sellQty * avgCost
        quantity -= sellQty
        if (quantity <= 0.0001) {
          quantity = 0
          costBasis = 0
          firstBought = null
        }
      }
    }
  }

  if (closedTradeRows.length > 0) {
    await supabase
      .from('on_closed_trades')
      .upsert(closedTradeRows, { onConflict: 'transaction_id' })
  }
}

/**
 * Rebuild ON position from scratch using all transactions for this ticker.
 */
export async function rebuildONPosition(
  supabase: SupabaseClient,
  userId: string,
  ticker: string
): Promise<void> {
  assertUserId(userId)
  const normalizedTicker = ticker.toUpperCase().trim()

  // 1. Rebuild history (closed trades)
  await rebuildONClosedTrades(supabase, userId, normalizedTicker)

  // 2. Recalculate current position
  const { data: allTx, error: fetchErr } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .eq('ticker', normalizedTicker)
    .eq('asset_type', 'ON')
    .order('date', { ascending: true })
    .order('created_at', { ascending: true })

  if (fetchErr) throw fetchErr

  if (!allTx || allTx.length === 0) {
    await supabase
      .from('on_positions')
      .delete()
      .eq('user_id', userId)
      .eq('ticker', normalizedTicker)
    if (isRedisReady()) await getRedis()?.del(`summary:${userId}`)
    return
  }

  let quantity = 0
  let costBasis = 0
  let firstBought: string | null = null

  for (const tx of allTx) {
    const qty = Math.abs(tx.quantity)
    if (tx.operation === 'COMPRA') {
      if (quantity === 0) firstBought = tx.date
      costBasis += qty * tx.price + (tx.commission || 0)
      quantity += qty
    } else if (tx.operation === 'VENTA') {
      if (quantity > 0) {
        const sellQty = Math.min(qty, quantity)
        const avgCost = costBasis / quantity
        costBasis -= sellQty * avgCost
        quantity -= sellQty
        if (quantity <= 0.0001) {
          quantity = 0
          costBasis = 0
          firstBought = null
        }
      }
    }
  }

  // Upsert or delete final position
  if (quantity <= 0.0001) {
    await supabase
      .from('on_positions')
      .delete()
      .eq('user_id', userId)
      .eq('ticker', normalizedTicker)
  } else {
    const avgCost = costBasis / quantity
    await supabase
      .from('on_positions')
      .upsert({
        user_id: userId,
        ticker: normalizedTicker,
        quantity,
        avg_cost: avgCost,
        total_invested: costBasis,
        first_bought: firstBought || new Date().toISOString(),
        last_updated: new Date().toISOString(),
        version: 1
      }, { onConflict: 'user_id,ticker' })
  }

  if (isRedisReady()) {
    try { await getRedis()?.del(`summary:${userId}`) } catch {}
  }
}
