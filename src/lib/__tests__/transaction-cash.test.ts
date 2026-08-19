import { describe, it, expect } from 'vitest'
import { buildCashMovementForTransaction, signedQuantity } from '../transaction-cash'

// ── buildCashMovementForTransaction ─────────────────────────────────────────
// Contract mirror of process_transaction_atomic §7 (migration 030): the
// movement's TYPE is the operation itself and transaction_id stays linked.
// The old PATCH handler recreated movements as RETIRO/DEPOSITO via the RPC,
// which writes DEPOSITO/RETIRO with transaction_id = NULL — every edited
// buy/sell forged a fake external flow into the drawdown.

describe('buildCashMovementForTransaction', () => {
  it('COMPRA → type COMPRA, amount = qty·price + commission', () => {
    const movement = buildCashMovementForTransaction({
      operation: 'COMPRA', quantity: 10, price: 100, commission: 5,
    })
    expect(movement).toEqual({ type: 'COMPRA', amount: 1005 })
  })

  it('VENTA → type VENTA, amount = qty·price − commission (qty sign-agnostic)', () => {
    const movement = buildCashMovementForTransaction({
      operation: 'VENTA', quantity: -10, price: 100, commission: 5,
    })
    expect(movement).toEqual({ type: 'VENTA', amount: 995 })
  })

  it('DIVIDENDO → type DIVIDENDO, amount = qty·price (commission not netted, like the RPC)', () => {
    const movement = buildCashMovementForTransaction({
      operation: 'DIVIDENDO', quantity: 40, price: 0.5, commission: 0,
    })
    expect(movement).toEqual({ type: 'DIVIDENDO', amount: 20 })
  })

  it('CUPON → type CUPON, amount = qty·price', () => {
    const movement = buildCashMovementForTransaction({
      operation: 'CUPON', quantity: 500, price: 1, commission: 0,
    })
    expect(movement).toEqual({ type: 'CUPON', amount: 500 })
  })

  it('returns null for operations that do not move cash through a transaction', () => {
    expect(
      buildCashMovementForTransaction({ operation: 'DEPOSITO' as never, quantity: 1, price: 1, commission: 0 })
    ).toBeNull()
  })

  it('never produces a negative amount (RPC stores ABS; direction lives in type)', () => {
    const movement = buildCashMovementForTransaction({
      operation: 'VENTA', quantity: 1, price: 1, commission: 5,
    })
    expect(movement!.amount).toBeGreaterThanOrEqual(0)
  })
})

// ── signedQuantity ───────────────────────────────────────────────────────────
// The RPC stores VENTA as -ABS(qty); the PATCH handler wrote the raw positive
// form and silently broke the convention.

describe('signedQuantity', () => {
  it('stores VENTA as negative regardless of input sign', () => {
    expect(signedQuantity('VENTA', 10)).toBe(-10)
    expect(signedQuantity('VENTA', -10)).toBe(-10)
  })

  it('stores every other operation as positive', () => {
    expect(signedQuantity('COMPRA', -10)).toBe(10)
    expect(signedQuantity('DIVIDENDO', 40)).toBe(40)
    expect(signedQuantity('CUPON', 500)).toBe(500)
  })
})
