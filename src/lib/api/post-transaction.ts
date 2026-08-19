/**
 * Single client entry point for creating a transaction.
 *
 * The ACCION and CEDEAR forms both hit POST /api/transactions and both have to
 * handle the ticker-confirmation 409. Implementing that dance twice is how the
 * two paths drift apart, so it lives here once.
 */
import type { ResolveResult } from '../ticker-identity'
import type { RetroactiveWarning } from './retroactive-warning'

export type PostTransactionResult =
  | { ok: true; warnings?: RetroactiveWarning[] }
  | { ok: false; kind: 'needs-confirmation'; resolution: ResolveResult }
  | { ok: false; kind: 'error'; message: string }

export async function postTransaction(
  payload: Record<string, unknown>
): Promise<PostTransactionResult> {
  const res = await fetch('/api/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (res.ok) {
    // A malformed success body is still a success: the row was written.
    const created = await res.json().catch(() => null)
    return { ok: true, warnings: created?.warnings }
  }

  let body: any = null
  try {
    body = await res.json()
  } catch {
    return { ok: false, kind: 'error', message: 'Error al guardar la operación' }
  }

  if (res.status === 409 && body?.code === 'TICKER_UNCONFIRMED') {
    return { ok: false, kind: 'needs-confirmation', resolution: body.resolution }
  }

  return { ok: false, kind: 'error', message: body?.error || 'Error al guardar la operación' }
}
