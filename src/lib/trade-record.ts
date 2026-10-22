import type { SupabaseClient } from '@supabase/supabase-js'
import type { Moneda, TransactionInput } from '@/types'
import type { CedearTradeInput } from './schemas/transaction'
import { getFxRate } from './fx-rates'

/**
 * The faithful trade record (migration 044): what the broker ticket showed, next
 * to the engine values derived from it.
 *
 * The engine unit for stocks and CEDEARs is USD-CCL per underlying share, and
 * the engine quantity is in underlying shares. A CEDEAR ticket is a CEDEAR count
 * and a price per CEDEAR in pesos, dólar MEP or dólar cable, so both engine
 * values depend on the ratio and on the FX of the trade date.
 */

export type TradeCurrency = 'ARS' | 'MEP' | 'CCL'
export type FxSource = 'reference' | 'user' | 'reconstructed'

export interface TradeRecord {
  tradeCurrency: TradeCurrency
  tradeQuantity: number
  tradePrice: number
  tradeCommission: number
  cedearRatio: number | null
  fxMep: number | null
  fxCcl: number | null
  fxDate: string | null
  fxSource: FxSource | null
}

export class TradeRecordError extends Error {
  constructor(message: string, readonly status: 400 | 422) {
    super(message)
  }
}

/** An amount in `currency` expressed in USD-CCL. */
function toCcl(amount: number, currency: TradeCurrency, fxMep: number | null, fxCcl: number | null): number {
  if (currency === 'CCL') return amount
  if (!fxCcl) throw new TradeRecordError('Falta la cotización del dólar cable para esa fecha.', 422)
  if (currency === 'ARS') return amount / fxCcl
  if (!fxMep) throw new TradeRecordError('Falta la cotización del dólar MEP para esa fecha.', 422)
  return (amount * fxMep) / fxCcl
}

/**
 * Engine values of a CEDEAR ticket. Pure, so the form's preview and the server
 * run the same arithmetic. The commission is a total, so it takes no ratio.
 */
export function deriveCedearEngineValues(t: {
  tradeCurrency: TradeCurrency
  tradeQuantity: number
  tradePrice: number
  tradeCommission: number
  ratio: number
  fxMep: number | null
  fxCcl: number | null
}): { quantity: number; price: number; commission: number } {
  return {
    quantity: t.tradeQuantity / t.ratio,
    price: toCcl(t.tradePrice, t.tradeCurrency, t.fxMep, t.fxCcl) * t.ratio,
    commission: toCcl(t.tradeCommission, t.tradeCurrency, t.fxMep, t.fxCcl),
  }
}

/**
 * Builds the engine input and the trade record for a CEDEAR ticket: the ratio
 * from `cedears`, and any FX the client did not send from `fx_rates` for the
 * trade date (with its fallback date). An FX the client sent is one the user
 * edited, so the record says `user`.
 */
export async function recordCedearTrade(
  supabase: SupabaseClient,
  input: CedearTradeInput
): Promise<TransactionInput & { tradeRecord: TradeRecord }> {
  const { data: cedear, error } = await supabase.from('cedears').select('ratio').eq('ticker', input.ticker).maybeSingle()
  if (error) throw new Error(`cedears read: ${error.message}`)
  const ratio = Number(cedear?.ratio)
  if (!cedear || !(ratio > 0)) throw new TradeRecordError(`${input.ticker} no figura en la lista de CEDEARs.`, 400)

  const [mepRef, cclRef] = await Promise.all([
    input.fxMep === undefined ? getFxRate(supabase, input.date, 'mep') : null,
    input.fxCcl === undefined ? getFxRate(supabase, input.date, 'ccl') : null,
  ])
  const fxMep = input.fxMep ?? mepRef?.rate ?? null
  const fxCcl = input.fxCcl ?? cclRef?.rate ?? null
  const userEdited = input.fxMep !== undefined || input.fxCcl !== undefined

  const engine = deriveCedearEngineValues({ ...input, ratio, fxMep, fxCcl })
  const moneda: Moneda = input.tradeCurrency === 'ARS' ? 'ARS' : 'USD'

  return {
    date: input.date,
    ticker: input.ticker,
    operation: input.operation,
    ...engine,
    notes: input.notes,
    assetType: 'CEDEAR',
    moneda,
    tradeRecord: {
      tradeCurrency: input.tradeCurrency,
      tradeQuantity: input.tradeQuantity,
      tradePrice: input.tradePrice,
      tradeCommission: input.tradeCommission,
      cedearRatio: ratio,
      fxMep,
      fxCcl,
      fxDate: cclRef?.date ?? mepRef?.date ?? (fxMep || fxCcl ? input.date : null),
      fxSource: fxMep || fxCcl ? (userEdited ? 'user' : 'reference') : null,
    },
  }
}

/** RPC parameters of process_transaction_atomic for a trade record (migration 044). */
export function tradeRecordRpcParams(r: TradeRecord) {
  return {
    p_trade_currency: r.tradeCurrency,
    p_trade_quantity: r.tradeQuantity,
    p_trade_price: r.tradePrice,
    p_trade_commission: r.tradeCommission,
    p_cedear_ratio: r.cedearRatio,
    p_fx_mep: r.fxMep,
    p_fx_ccl: r.fxCcl,
    p_fx_date: r.fxDate,
    p_fx_source: r.fxSource,
  }
}
