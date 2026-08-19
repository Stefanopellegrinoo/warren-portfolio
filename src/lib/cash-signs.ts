/**
 * The single sign rule for the cash ledger.
 *
 * `cash_movements.amount` is ALWAYS positive — the direction lives in `type`.
 * This was inlined in rebuildCashBalance; the snapshot backfill replays the
 * same ledger and must not carry a second copy of the rule, because two copies
 * are how a replayed balance and the stored balance drift apart.
 *
 * WORKER-SAFE: no imports, pure.
 */
export const CASH_CREDIT_TYPES = ['DEPOSITO', 'CUPON', 'DIVIDENDO', 'VENTA'] as const
export const CASH_DEBIT_TYPES = ['RETIRO', 'COMPRA'] as const

const CREDIT = new Set<string>(CASH_CREDIT_TYPES)
const DEBIT = new Set<string>(CASH_DEBIT_TYPES)

/**
 * Signed contribution of one movement. An unknown type contributes nothing.
 *
 * A non-numeric amount THROWS rather than contributing zero. The column has no
 * numeric or positivity CHECK (migration 003), so the contract is enforced
 * here; and the backfill replays ~1150 days per user, where a silently skipped
 * movement would bend the whole reconstructed series with nothing to show for
 * it. (`null` coerces to 0 through Number() and is not treated as corrupt —
 * the column is NOT NULL, so it cannot arrive that way.)
 */
export function cashDelta(type: string, amount: number): number {
  const magnitude = Math.abs(Number(amount))
  if (!Number.isFinite(magnitude)) {
    throw new Error(`[Cash] movement of type ${type} has a non-numeric amount: ${String(amount)}`)
  }

  if (CREDIT.has(type)) return magnitude
  if (DEBIT.has(type)) return -magnitude
  return 0
}
