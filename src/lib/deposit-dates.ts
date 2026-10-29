/**
 * Deposits recorded after the purchases they paid (odd/tasks/deposit-dates.md). The derived
 * history already moves them for its own math (statistics-truth S10, `fundPurchases`); this
 * module turns that same computation into a proposal a user reviews, and checks what the user
 * confirms before the dates are saved — for any user, never shaped to one account.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeError } from './errors'
import { getDerivedSeries } from './derived-series'
import { fundPurchases, type DerivedMovement } from './derive-history'
import { argentinaDate } from './utils'

export interface DepositPart { date: string; amount: number }

export interface DepositDatesProposal {
  /** Each recorded deposit that paid earlier days: its id, its parts, and what stays on its own date. */
  deposits: Array<{ id: string; date: string; amount: number; remaining: number; parts: DepositPart[] }>
  /** Money moved in all, and the first day it reaches; 0 and null when nothing needs review. */
  total: number
  from: string | null
}

export interface RedateChange { id: string; parts: DepositPart[] }

export type RedateCheck =
  | { ok: true; changes: RedateChange[] }
  | { ok: false; status: 400 | 409; error: string }

type IdMovement = DerivedMovement & { id: string }

const PAGE = 1000
// The column's precision: numeric(18,4).
const round4 = (n: number) => Math.round(n * 1e4) / 1e4
const sameAmount = (a: number, b: number) => Math.abs(a - b) < 1e-4

/** Pure: the proposal from the user's movements (with their ids) and the core's income. */
export function proposalFrom(movements: IdMovement[], income: Array<{ date: string; amount: number }>, today: string): DepositDatesProposal {
  const { proposals } = fundPurchases(movements, income, today)
  const deposits = proposals.map(p => {
    const parts = p.parts.map(x => ({ date: x.date, amount: round4(x.amount) }))
    const amount = round4(p.amount)
    return { id: movements[p.index].id, date: p.date, amount, remaining: round4(amount - parts.reduce((s, x) => s + x.amount, 0)), parts }
  })
  const all = deposits.flatMap(d => d.parts)
  return {
    deposits,
    total: round4(all.reduce((s, x) => s + x.amount, 0)),
    from: all.map(x => x.date).sort()[0] ?? null,
  }
}

/**
 * Pure: what the user confirms is the proposal itself — the same deposits, split into the same
 * amounts — and only the dates may differ, each before its deposit and not after today. Anything
 * else means the movements changed since the proposal was made (S2, S3).
 */
export function checkRedatePlan(changes: RedateChange[], proposal: DepositDatesProposal, today: string): RedateCheck {
  if (new Set(changes.map(c => c.id)).size !== changes.length) {
    return { ok: false, status: 400, error: 'Cada depósito puede aparecer una sola vez.' }
  }
  for (const change of changes) {
    const proposed = proposal.deposits.find(d => d.id === change.id)
    const sameSplit = proposed && proposed.parts.length === change.parts.length
      && proposed.parts.every((p, i) => sameAmount(p.amount, change.parts[i].amount))
    if (!sameSplit) {
      return { ok: false, status: 409, error: 'Tus movimientos cambiaron desde que se armó la propuesta: revisala de nuevo.' }
    }
    if (change.parts.some(p => p.date >= proposed.date)) {
      return { ok: false, status: 400, error: 'Cada parte tiene que tener una fecha anterior a la de su depósito.' }
    }
    if (change.parts.some(p => p.date > today)) {
      return { ok: false, status: 400, error: 'Una fecha no puede ser posterior a hoy.' }
    }
  }
  return { ok: true, changes }
}

/** Every cash movement of the user with its id, in the order the derived series reads them. */
async function readMovements(supabase: SupabaseClient, userId: string): Promise<IdMovement[]> {
  const rows: IdMovement[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('cash_movements')
      .select('id, type, amount, date, transaction_id')
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw normalizeError(error)
    rows.push(...((data ?? []) as IdMovement[]))
    if ((data ?? []).length < PAGE) return rows
  }
}

/** The proposal for one user, from the same income the derived history uses. */
export async function loadDepositProposal(supabase: SupabaseClient, userId: string, today = argentinaDate()): Promise<DepositDatesProposal> {
  const [movements, derived] = await Promise.all([readMovements(supabase, userId), getDerivedSeries(supabase, userId)])
  return proposalFrom(movements, derived.income, today)
}
