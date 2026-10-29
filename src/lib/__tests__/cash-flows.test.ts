import { describe, it, expect, vi } from 'vitest'
import { fetchIncomeMovements } from '../cash-flows'

/** Records the query it was asked for and replays pages in order. */
function fakeSupabase(pages: any[][]) {
  const calls: any = { filters: {}, ranges: [] }
  let call = 0
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn((col: string, val: unknown) => { calls.filters[col] = val; return builder }),
    is: vi.fn((col: string, val: unknown) => { calls.filters[`is:${col}`] = val; return builder }),
    in: vi.fn((col: string, val: unknown) => { calls.filters[`in:${col}`] = val; return builder }),
    order: vi.fn(() => builder),
    range: vi.fn((from: number, to: number) => {
      calls.ranges.push([from, to])
      return Promise.resolve({ data: pages[call++] ?? [], error: null })
    }),
  }
  return { client: { from: vi.fn(() => builder) } as any, calls }
}

const row = (over = {}) => ({ date: '2026-07-10', type: 'DEPOSITO', amount: 1000, ...over })

describe('fetchIncomeMovements', () => {
  it('selects CUPON and DIVIDENDO and does NOT filter on transaction_id', async () => {
    // Income is income whether it was booked manually or written by the RPC
    // alongside a transaction. Both write a cash_movements row; reading here
    // covers both and cannot double count.
    const { client, calls } = fakeSupabase([[]])
    await fetchIncomeMovements(client, 'u1')
    expect(calls.filters['in:type']).toEqual(['CUPON', 'DIVIDENDO'])
    expect(calls.filters['is:transaction_id']).toBeUndefined()
  })

  it('returns date, type and unsigned amount', async () => {
    const { client } = fakeSupabase([[row({ type: 'CUPON', amount: 8300 })]])
    expect(await fetchIncomeMovements(client, 'u1')).toEqual([
      { date: '2026-07-10', type: 'CUPON', amount: 8300 },
    ])
  })

  it('walks pages until a short one', async () => {
    const full = Array.from({ length: 1000 }, () => row({ type: 'CUPON' }))
    const { client, calls } = fakeSupabase([full, []])
    expect(await fetchIncomeMovements(client, 'u1')).toHaveLength(1000)
    expect(calls.ranges).toEqual([[0, 999], [1000, 1999]])
  })
})
