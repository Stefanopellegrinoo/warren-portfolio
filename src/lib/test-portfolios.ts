// Shared plumbing for the /api/test-portfolios routes: body parsing at the boundary, Postgres
// error mapping (generic messages only) and the per-item catalog rules (A7 floating, A8 USD only,
// R4.1 lot rules). Ownership is NEVER checked here: it is enforced by RLS on the user's client.
import { NextResponse } from 'next/server'
import type { ZodType } from 'zod'
import type { OnAnalysis } from './on-analytics'
import { simulateOn } from './on-simulator'
import { ID_RE, MAX_ITEMS, MAX_PORTFOLIOS } from './schemas/test-portfolio'
import { argentinaDate } from './utils'

export const fail = (error: string, status: number) => NextResponse.json({ error }, { status })
export const validId = (id: string) => ID_RE.test(id)
export const BAD_ID = () => fail('Identificador inválido', 400)
export const NOT_FOUND = () => fail('Cartera no encontrada', 404)

/** Parses and validates a JSON body; the second element is the error response to return, if any. */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<[T, null] | [null, NextResponse]> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return [null, fail('Cuerpo de la solicitud inválido', 400)]
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return [null, fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 400)]
  return [parsed.data, null]
}

interface DbError { code?: string; message?: string }

/** Maps a database error to a Spanish response; anything unexpected is a generic 500 (logged, never echoed). */
export function dbFail(error: DbError, what: 'portfolio' | 'item'): NextResponse {
  if (error.message?.includes('test_portfolio_limit')) return fail(`Llegaste al máximo de ${MAX_PORTFOLIOS} carteras`, 409)
  if (error.message?.includes('test_portfolio_item_limit')) return fail(`Una cartera admite hasta ${MAX_ITEMS} ONs`, 409)
  if (error.code === '23505') return fail(what === 'portfolio' ? 'Ya tenés una cartera con ese nombre' : 'Esa ON ya está en la cartera', 409)
  if (error.code === '42501' || error.code === '23503') return NOT_FOUND() // RLS hid the parent: not yours or not there
  console.error('[Test portfolios API] database error:', error.code, error.message)
  return fail('No se pudo completar la operación', 500)
}

export interface ItemRow {
  id: string
  isin: string
  input_mode: 'usd' | 'vn'
  amount: number | string
  manual_price: number | string | null
}

export const toItem = (r: ItemRow) => ({
  id: r.id,
  isin: r.isin,
  mode: r.input_mode,
  amount: Number(r.amount),
  manualPrice: r.manual_price === null || r.manual_price === undefined ? null : Number(r.manual_price),
})

/**
 * Why an item cannot be saved, or null. A missing market price is allowed (the view flags it and a
 * manual price can be added later); every other refusal (floating, not USD, lot rules, matured) is not.
 */
export function itemRefusal(analysis: OnAnalysis, item: { mode: 'usd' | 'vn'; amount: number; manualPrice: number | null }): string | null {
  const r = simulateOn({ analysis, mode: item.mode, amount: item.amount, manualPrice: item.manualPrice, today: argentinaDate() })
  return r.ok || r.reason === 'no-price' ? null : r.message
}
