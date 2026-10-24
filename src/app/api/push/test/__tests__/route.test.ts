// odd/tasks/push-notificaciones.md S2-S3: "Enviar una prueba" sends a test notification to the user's
// devices and says in Spanish why it could not.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({ requireUser: () => mockRequireUser(), isAuthFailure: (r: object) => 'error' in r }))
const mockRateLimit = vi.fn()
vi.mock('@/lib/rate-limit', async (orig) => ({ ...(await orig<object>()), rateLimit: (...a: unknown[]) => mockRateLimit(...a) }))
const mockSend = vi.fn()
vi.mock('@/lib/push', () => ({ sendPushToUser: (...a: unknown[]) => mockSend(...a) }))

const { POST } = await import('../route')
const supabase = { from: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireUser.mockResolvedValue({ supabase, user: { id: 'u1' } })
  mockRateLimit.mockResolvedValue(true)
})

describe('POST /api/push/test', () => {
  it('sends a test notification to the signed-in user with their client', async () => {
    mockSend.mockResolvedValue({ ok: true, sent: 2 })
    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: 2 })
    expect(mockSend).toHaveBeenCalledWith(supabase, 'u1', {
      title: 'Warren', body: 'Las notificaciones funcionan en este dispositivo.', url: '/strategies?tab=alertas', tag: 'push-test',
    })
    expect(mockRateLimit).toHaveBeenCalledWith('rl:push-test:u1', 5, 60)
  })

  it.each([
    ['no devices', 409, 'Este dispositivo todavía no tiene los avisos activados.'],
    ['push not configured', 503, 'Los avisos todavía no están configurados en el servidor.'],
    ['no device accepted the push', 502, 'No se pudo enviar la prueba. Probá de nuevo en un rato.'],
  ])('%s → %i in Spanish', async (error, status, message) => {
    mockSend.mockResolvedValue({ ok: false, error })
    const res = await POST()
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: message })
  })

  it('too many tests in a minute is a 429 and sends nothing', async () => {
    mockRateLimit.mockResolvedValue(false)
    expect((await POST()).status).toBe(429)
    expect(mockSend).not.toHaveBeenCalled()
  })
})
