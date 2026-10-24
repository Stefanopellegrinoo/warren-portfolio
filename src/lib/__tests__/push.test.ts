// odd/tasks/push-notificaciones.md S3-S4: the server sends a push to each of the user's devices,
// drops the ones the push service says are gone, and never contacts a URL that is not a push service.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sendNotification = vi.fn()
vi.mock('web-push', () => ({ default: { sendNotification: (...a: unknown[]) => sendNotification(...a) } }))

const { sendPushToUser, pushKeys } = await import('../push')
const { isPushEndpoint } = await import('../push-endpoint')

const APPLE = 'https://web.push.apple.com/QGuQyavXutnMH'
const FCM = 'https://fcm.googleapis.com/fcm/send/abc'
const sub = (id: string, endpoint: string) => ({ id, endpoint, p256dh: `p-${id}`, auth: `a-${id}` })

function supabase(rows: ReturnType<typeof sub>[]) {
  const deleted: string[][] = []
  const client = {
    from: (table: string) => {
      expect(table).toBe('push_subscriptions')
      return {
        select: () => ({ eq: (_c: string, userId: string) => Promise.resolve({ data: userId === 'u1' ? rows : [], error: null }) }),
        delete: () => ({ in: (_c: string, ids: string[]) => { deleted.push(ids); return Promise.resolve({ error: null }) } }),
      }
    },
  }
  return { client: client as never, deleted }
}

const payload = { title: 'Alerta de precio: AAPL', body: 'Cruzó hacia arriba 180', url: '/trading?symbol=AAPL', tag: 'alert-1' }

beforeEach(() => {
  vi.stubEnv('VAPID_PUBLIC_KEY', 'pub')
  vi.stubEnv('VAPID_PRIVATE_KEY', 'priv')
  vi.stubEnv('VAPID_SUBJECT', 'mailto:avisos@warren.app')
  sendNotification.mockReset().mockResolvedValue({ statusCode: 201 })
})
afterEach(() => vi.unstubAllEnvs())

describe('sendPushToUser', () => {
  it('sends the payload to every device of the user with the VAPID keys', async () => {
    const { client } = supabase([sub('s1', APPLE), sub('s2', FCM)])
    const result = await sendPushToUser(client, 'u1', payload)
    expect(result).toEqual({ ok: true, sent: 2 })
    expect(sendNotification).toHaveBeenCalledTimes(2)
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: APPLE, keys: { p256dh: 'p-s1', auth: 'a-s1' } },
      JSON.stringify(payload),
      { vapidDetails: { subject: 'mailto:avisos@warren.app', publicKey: 'pub', privateKey: 'priv' }, TTL: 3600 },
    )
  })

  it('deletes a device the push service reports gone (404/410) and keeps sending to the rest', async () => {
    sendNotification.mockImplementation(async (s: { endpoint: string }) => {
      if (s.endpoint === APPLE) throw Object.assign(new Error('gone'), { statusCode: 410 })
      return { statusCode: 201 }
    })
    const { client, deleted } = supabase([sub('s1', APPLE), sub('s2', FCM)])
    expect(await sendPushToUser(client, 'u1', payload)).toEqual({ ok: true, sent: 1 })
    expect(deleted).toEqual([['s1']])
  })

  it('never contacts a stored endpoint that is not a push service', async () => {
    const { client } = supabase([sub('s1', 'http://169.254.169.254/latest'), sub('s2', 'https://evil.example/push'), sub('s3', FCM)])
    expect(await sendPushToUser(client, 'u1', payload)).toEqual({ ok: true, sent: 1 })
    expect(sendNotification).toHaveBeenCalledTimes(1)
    expect(sendNotification.mock.calls[0][0].endpoint).toBe(FCM)
  })

  it('a failed send never throws: it answers why nothing was sent', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    sendNotification.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }))
    const { client, deleted } = supabase([sub('s1', APPLE)])
    expect(await sendPushToUser(client, 'u1', payload)).toEqual({ ok: false, error: 'no device accepted the push' })
    expect(deleted).toEqual([])
    err.mockRestore()
  })

  it('answers without sending when the user has no devices or the keys are missing', async () => {
    expect(await sendPushToUser(supabase([]).client, 'u2', payload)).toEqual({ ok: false, error: 'no devices' })
    vi.stubEnv('VAPID_PRIVATE_KEY', '')
    expect(pushKeys()).toBeNull()
    expect(await sendPushToUser(supabase([sub('s1', APPLE)]).client, 'u1', payload)).toEqual({ ok: false, error: 'push not configured' })
    expect(sendNotification).not.toHaveBeenCalled()
  })
})

describe('isPushEndpoint', () => {
  it.each([APPLE, FCM, 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-par02p.notify.windows.com/w/?token=x'])('accepts %s', (url) => {
    expect(isPushEndpoint(url)).toBe(true)
  })
  it.each(['http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com.evil.example/x', 'https://evil.example/web.push.apple.com', 'https://user@web.push.apple.com/x', 'https://web.push.apple.com:8443/x', 'not a url'])('rejects %s', (url) => {
    expect(isPushEndpoint(url)).toBe(false)
  })
})
