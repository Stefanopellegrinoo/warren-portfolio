import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GENERIC_ERROR } from '@/lib/api/errors'

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({ requireUser: () => mockRequireUser(), isAuthFailure: (r: any) => 'error' in r }))
vi.mock('@/lib/redis', () => ({ invalidateUserCache: vi.fn() }))
const mockDelete = vi.fn()
vi.mock('@/lib/cash-engine', async (orig) => ({
  ...(await orig<object>()),
  deleteCashMovement: (...a: unknown[]) => mockDelete(...a),
}))

const { DELETE } = await import('../route')
const { LinkedMovementError } = await import('@/lib/cash-engine')
const ID = '7f1c2a3e-5b6d-4e8f-9a0b-1c2d3e4f5a6b'
const del = () => DELETE(new Request(`http://localhost/api/cash/movements/${ID}`, { method: 'DELETE' }), { params: { id: ID } })

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireUser.mockResolvedValue({ supabase: {}, user: { id: 'u1' } })
})

describe('DELETE /api/cash/movements/[id] (S6)', () => {
  it('a database failure answers the generic 500, never its text', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockDelete.mockRejectedValue(new Error('permission denied for table cash_movements'))

    const res = await del()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: GENERIC_ERROR })
  })

  it('keeps the domain answers: not found is a 404, a linked movement a 409', async () => {
    mockDelete.mockRejectedValueOnce(new Error('Movimiento no encontrado'))
    const missing = await del()
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'Movimiento no encontrado' })

    mockDelete.mockRejectedValueOnce(new LinkedMovementError())
    const linked = await del()
    expect(linked.status).toBe(409)
    expect(await linked.json()).toEqual({ error: new LinkedMovementError().message })
  })
})
