/**
 * The worker's per-minute cycle reads what only changes on a write once, until the ledger version
 * moves, the day changes or an hour passes (odd/tasks/supabase-efficiency.md S2-S3).
 */
import { describe, it, expect, vi } from 'vitest'
import { memoByLedgerVersion, MAX_AGE_MS } from '../ledger-memo'

function setup() {
  const clock = { version: '3' as string | null, today: '2026-10-27', now: 0 }
  const load = vi.fn(async () => ({ read: load.mock.calls.length }))
  const reuse = memoByLedgerVersion(load, {
    version: async () => clock.version,
    today: () => clock.today,
    now: () => clock.now,
  })
  return { clock, load, reuse }
}

describe('memoByLedgerVersion', () => {
  it('reads once while nothing was written on the same day', async () => {
    const { load, reuse } = setup()
    const first = await reuse()

    expect(await reuse()).toBe(first)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('reads again after a write (the version moved)', async () => {
    const { clock, load, reuse } = setup()
    await reuse()
    clock.version = '4'

    expect(await reuse()).toEqual({ read: 2 })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('reads again on a new day', async () => {
    const { clock, load, reuse } = setup()
    await reuse()
    clock.today = '2026-10-28'

    await reuse()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('reads again after an hour, for a write that never moved the version', async () => {
    const { clock, load, reuse } = setup()
    await reuse()
    clock.now = MAX_AGE_MS - 1
    await reuse()
    expect(load).toHaveBeenCalledTimes(1)

    clock.now = MAX_AGE_MS
    await reuse()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('reads every time when Redis cannot give the version, as before', async () => {
    const { clock, load, reuse } = setup()
    clock.version = null
    await reuse()
    await reuse()

    expect(load).toHaveBeenCalledTimes(2)
  })

  it('a version read that fails counts as no version: it never breaks the read', async () => {
    const load = vi.fn(async () => 'rows')
    const reuse = memoByLedgerVersion(load, { version: async () => { throw new Error('redis down') }, today: () => 'd', now: () => 0 })

    expect(await reuse()).toBe('rows')
    await reuse()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('a failed read is not kept: the next call reads again', async () => {
    const { load, reuse } = setup()
    load.mockRejectedValueOnce(new Error('db down'))

    await expect(reuse()).rejects.toThrow('db down')
    await reuse()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('calls that overlap share one read', async () => {
    const { load, reuse } = setup()
    const [a, b] = await Promise.all([reuse(), reuse()])

    expect(a).toBe(b)
    expect(load).toHaveBeenCalledTimes(1)
  })
})
