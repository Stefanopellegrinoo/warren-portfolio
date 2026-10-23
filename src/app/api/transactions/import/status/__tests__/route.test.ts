// T2 (odd/tasks/security-hardening.md S2): a user reads only their own import job.
import { describe, it, expect, vi } from 'vitest'

const fromId = vi.fn()
vi.mock('@/lib/api-auth', () => ({ requireUser: async () => ({ supabase: {}, user: { id: 'me' } }), isAuthFailure: (r: any) => 'error' in r }))
vi.mock('@/lib/queue', () => ({ getImportQueue: () => ({}) }))
vi.mock('bullmq', () => ({ Job: { fromId: (...a: unknown[]) => fromId(...a) } }))

const { GET } = await import('../route')

const job = (userId: string) => ({
  data: { userId },
  progress: { percentage: 40 },
  returnvalue: { imported: 3, errors: [{ ticker: 'AAPL', error: 'secret detail' }] },
  getState: async () => 'active',
})
const get = (jobId: string) => GET(new Request(`http://test.local/api/transactions/import/status?jobId=${jobId}`) as never)

describe('GET /api/transactions/import/status', () => {
  it("returns 404 and no job data for another user's job", async () => {
    fromId.mockResolvedValue(job('someone-else'))

    const res = await get('7')
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(JSON.stringify(body)).not.toContain('secret detail')
  })

  it('returns the state, progress and result of your own job', async () => {
    fromId.mockResolvedValue(job('me'))

    const res = await get('7')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ jobId: '7', state: 'active', progress: { percentage: 40 }, result: { imported: 3 } })
  })
})
