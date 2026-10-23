import { NextResponse } from 'next/server'

/** Same text as `dbFail` in `src/lib/test-portfolios.ts`, so the UI shows one message for every failure. */
export const GENERIC_ERROR = 'No se pudo completar la operación'

// process_transaction_atomic catches EVERY error and re-raises it as P0001
// 'Transaction failed: <msg> (SQLSTATE: <code>)': a wrapped code other than P0001 is internal.
const WRAPPED_INTERNAL = /\(SQLSTATE: (?!P0001\))[0-9A-Z]{5}\)$/

// Plain Errors that portfolio-engine.ts and on-engine.ts throw on purpose for the user.
// ponytail: matched by text because the engines throw bare `Error`; a typed error class there replaces this list.
const ENGINE_GUARDS = [/^Hay una importación masiva en curso/, /^ON tickers must end with 'D'/]

/** The message of a deliberate, user-facing failure, or null for anything unexpected. */
function domainMessage(err: unknown): string | null {
  const e = err as { code?: unknown; message?: unknown; cause?: { code?: unknown } } | null
  const message = e?.message
  if (typeof message !== 'string') return null
  // A plpgsql RAISE EXCEPTION without SQLSTATE; normalizeError keeps the Postgrest error in `cause`.
  if ((e?.code ?? e?.cause?.code) === 'P0001') return WRAPPED_INTERNAL.test(message) ? null : message
  return ENGINE_GUARDS.some(re => re.test(message)) ? message : null
}

/**
 * The 500 answer for a caught failure. A deliberate user-facing message (a P0001 RAISE, an engine
 * guard) is kept; anything else is logged with `tag` and replaced by a generic message, so internal
 * text (SQL, hostnames, library errors) never reaches the client.
 */
export function serverError(tag: string, err: unknown): NextResponse {
  const message = domainMessage(err)
  if (message) return NextResponse.json({ error: message }, { status: 500 })
  console.error(`[${tag}]`, err)
  return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 })
}
