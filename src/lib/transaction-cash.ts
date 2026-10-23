/**
 * Cash-movement contract for transaction-linked operations.
 *
 * Mirror of process_transaction_atomic (migration 046): the movement's
 * TYPE is the operation itself (COMPRA/VENTA/DIVIDENDO), the amount is
 * stored unsigned (direction lives in the type), and transaction_id stays
 * linked by the caller.
 *
 * This exists because the PATCH handler used to recreate movements through
 * processCashMovement with type RETIRO/DEPOSITO — and the RPC writes those
 * with transaction_id = NULL, which is precisely the external-flow predicate
 * of the flow-adjusted max drawdown. Every edited buy/sell forged a fake
 * deposit or withdrawal into the metric.
 */

// No CUPON: ON coupons are automatic (odd/tasks/nucleo-ledger.md S4, S10).
export type TransactionOperation = 'COMPRA' | 'VENTA' | 'DIVIDENDO'

export interface TransactionCashMovement {
  type: TransactionOperation
  /** Unsigned, like the RPC's ABS(v_cash_delta). */
  amount: number
}

export function buildCashMovementForTransaction(tx: {
  operation: TransactionOperation
  quantity: number
  price: number
  commission?: number | null
}): TransactionCashMovement | null {
  const qty = Math.abs(Number(tx.quantity))
  const price = Number(tx.price)
  const commission = Number(tx.commission) || 0

  switch (tx.operation) {
    case 'COMPRA':
      return { type: 'COMPRA', amount: qty * price + commission }
    case 'VENTA':
      return { type: 'VENTA', amount: Math.abs(qty * price - commission) }
    case 'DIVIDENDO':
      return { type: 'DIVIDENDO', amount: qty * price }
    default:
      return null
  }
}

/** The RPC stores VENTA as -ABS(qty) and everything else as ABS(qty). */
export function signedQuantity(operation: string, quantity: number): number {
  const qty = Math.abs(Number(quantity))
  return operation === 'VENTA' ? -qty : qty
}
