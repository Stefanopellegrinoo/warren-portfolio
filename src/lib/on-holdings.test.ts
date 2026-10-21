import { describe, it, expect, vi } from 'vitest'
import { loadOnHoldings } from './on-holdings'

const client = (result: { data: unknown; error: unknown }) => {
  const calls: unknown[][] = []
  const q: any = {
    select: (...a: unknown[]) => { calls.push(['select', ...a]); return q },
    eq: (...a: unknown[]) => { calls.push(['eq', ...a]); return q },
    gt: (...a: unknown[]) => { calls.push(['gt', ...a]); return q },
    then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res),
  }
  return { sb: { from: vi.fn(() => q) } as any, calls }
}

describe('loadOnHoldings', () => {
  it('reads only the signed-in user\'s on_positions with quantity > 0 (read only)', async () => {
    const { sb, calls } = client({ data: [{ ticker: 'AAAAD', quantity: '100.5' }], error: null })
    const rows = await loadOnHoldings(sb, 'user-1')
    expect(sb.from).toHaveBeenCalledWith('on_positions')
    expect(calls).toContainEqual(['eq', 'user_id', 'user-1'])
    expect(calls).toContainEqual(['gt', 'quantity', 0])
    expect(rows).toEqual([{ ticker: 'AAAAD', quantity: 100.5 }])
  })
  it('throws on a read error', async () => {
    const { sb } = client({ data: null, error: { message: 'boom' } })
    await expect(loadOnHoldings(sb, 'u')).rejects.toThrow()
  })
})
