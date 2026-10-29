import { describe, it, expect } from 'vitest'
import { checkRedatePlan, proposalFrom } from '../deposit-dates'

const TODAY = '2026-04-15'
const leg = (id: string, type: string, amount: number, date: string) => ({ id, type, amount, date, transaction_id: `t-${id}` })
const deposit = (id: string, amount: number, date: string) => ({ id, type: 'DEPOSITO', amount, date, transaction_id: null })

// Purchases on 03-02 and 03-03 paid by deposits recorded on 03-31 and 04-09.
const MOVES = [
  leg('a', 'RETIRO', 500.12345, '2026-03-02'), leg('b', 'RETIRO', 700, '2026-03-03'),
  deposit('d1', 300, '2026-03-31'), deposit('d2', 2000, '2026-04-09'),
]

describe('proposalFrom — the deposits a user reviews (odd/tasks/deposit-dates.md S2)', () => {
  it('names each recorded deposit by its id, with the earlier days it paid and what stays on its date', () => {
    expect(proposalFrom(MOVES, [], TODAY)).toEqual({
      deposits: [
        { id: 'd1', date: '2026-03-31', amount: 300, remaining: 0, parts: [{ date: '2026-03-02', amount: 300 }] },
        // Amounts at the column's 4 decimals.
        { id: 'd2', date: '2026-04-09', amount: 2000, remaining: 1099.8765, parts: [{ date: '2026-03-02', amount: 200.1235 }, { date: '2026-03-03', amount: 700 }] },
      ],
      total: 1200.1235,
      from: '2026-03-02',
    })
  })

  it('nothing to review when every deposit came before what it paid', () => {
    expect(proposalFrom([deposit('d1', 5000, '2026-03-01'), leg('a', 'RETIRO', 500, '2026-03-02')], [], TODAY))
      .toEqual({ deposits: [], total: 0, from: null })
  })
})

describe('checkRedatePlan — what the user confirms must be the proposal, dates aside (S2, S3)', () => {
  const proposal = proposalFrom(MOVES, [], TODAY)
  const asProposed = proposal.deposits.map(d => ({ id: d.id, parts: d.parts.map(p => ({ ...p })) }))

  it('accepts the proposal as is, and a date the user moved earlier', () => {
    expect(checkRedatePlan(asProposed, proposal, TODAY)).toEqual({ ok: true, changes: asProposed })
    const edited = [{ id: 'd1', parts: [{ date: '2026-02-20', amount: 300 }] }]
    expect(checkRedatePlan(edited, proposal, TODAY)).toEqual({ ok: true, changes: edited })
  })

  it('refuses other amounts, other deposits or a different split: the movements changed meanwhile (409)', () => {
    const changed = { ok: false, status: 409, error: 'Tus movimientos cambiaron desde que se armó la propuesta: revisala de nuevo.' }
    expect(checkRedatePlan([{ id: 'd1', parts: [{ date: '2026-03-02', amount: 299 }] }], proposal, TODAY)).toEqual(changed)
    expect(checkRedatePlan([{ id: 'zz', parts: [{ date: '2026-03-02', amount: 300 }] }], proposal, TODAY)).toEqual(changed)
    expect(checkRedatePlan([{ id: 'd2', parts: [{ date: '2026-03-02', amount: 200.1235 }] }], proposal, TODAY)).toEqual(changed)
  })

  it('refuses a date on or after its deposit, a date after today, and the same deposit twice (400)', () => {
    expect(checkRedatePlan([{ id: 'd1', parts: [{ date: '2026-03-31', amount: 300 }] }], proposal, TODAY))
      .toEqual({ ok: false, status: 400, error: 'Cada parte tiene que tener una fecha anterior a la de su depósito.' })
    expect(checkRedatePlan([{ id: 'd1', parts: [{ date: '2026-03-02', amount: 300 }] }], proposal, '2026-03-01'))
      .toEqual({ ok: false, status: 400, error: 'Una fecha no puede ser posterior a hoy.' })
    expect(checkRedatePlan([asProposed[0], asProposed[0]], proposal, TODAY))
      .toEqual({ ok: false, status: 400, error: 'Cada depósito puede aparecer una sola vez.' })
  })
})
