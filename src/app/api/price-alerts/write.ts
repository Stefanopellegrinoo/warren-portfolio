// What the alert writes share (route.ts POST, [id]/route.ts PATCH); a route file may only export its handlers.
import { NextRequest, NextResponse } from 'next/server'
import { INVALID_JSON } from '@/lib/api/validation'
import { rateLimit } from '@/lib/rate-limit'
import { ALERT_ERRORS, ALERT_MAX_BODY_BYTES } from '@/lib/chart/alert-condition'

// Writes only: the chart reads its ticker's alerts on every symbol change.
const WRITE_LIMIT = 30
export const WRITE_WINDOW_SEC = 60
/** The DB refused a CHECK (migration 052): a condition that does not fit the alert. */
export const CHECK_VIOLATION = '23514'
export const INVALID_CONDITION = 'Esa condición no es válida para esta alerta.'

/** A write's body, read once and bounded before it is parsed. */
export async function readAlertBody(req: NextRequest): Promise<{ body: unknown } | { error: NextResponse }> {
  const fail = (error: string) => ({ error: NextResponse.json({ error }, { status: 400 }) })
  if (Number(req.headers.get('content-length') ?? 0) > ALERT_MAX_BODY_BYTES) return fail(ALERT_ERRORS.tooLarge)
  const text = await req.text()
  if (new TextEncoder().encode(text).length > ALERT_MAX_BODY_BYTES) return fail(ALERT_ERRORS.tooLarge)
  try {
    return { body: JSON.parse(text) }
  } catch {
    return fail(INVALID_JSON)
  }
}

/** POST and PATCH share one budget per user. */
export async function writeAllowed(userId: string) {
  return rateLimit(`rl:price-alerts:${userId}`, WRITE_LIMIT, WRITE_WINDOW_SEC)
}
