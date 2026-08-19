/**
 * Parses the balance-reconciliation form into the payload POST /api/cash/adjust
 * expects, or an error message for the user.
 *
 * Kept out of the component so the money boundary is testable: an empty field
 * coerces to 0 through Number(), which would silently reconcile the account to
 * zero instead of rejecting the input.
 */

export interface AdjustPayload {
  balance: number
  date: string
  description?: string
}

export type AdjustInputResult =
  | { ok: true; payload: AdjustPayload }
  | { ok: false; error: string }

export function buildAdjustPayload(
  rawBalance: string,
  date: string,
  description?: string
): AdjustInputResult {
  if (rawBalance.trim() === '') {
    return { ok: false, error: 'Ingresá un saldo válido' }
  }

  const balance = Number(rawBalance)
  if (!Number.isFinite(balance)) {
    return { ok: false, error: 'Ingresá un saldo válido' }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: 'Elegí una fecha válida' }
  }

  const trimmed = description?.trim()

  return {
    ok: true,
    payload: {
      balance,
      date,
      description: trimmed ? trimmed : undefined,
    },
  }
}
