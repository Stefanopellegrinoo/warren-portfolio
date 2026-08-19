import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock resend at the top level
const mockSend = vi.fn()
vi.mock('resend', () => {
  return {
    Resend: class MockResend {
      emails = {
        send: mockSend,
      }
    },
  }
})

// Reset all mocks and env stubs between tests
beforeEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
  // Reset the mock function for the next test
  mockSend.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ── sendTelegram ──────────────────────────────────────────

describe('sendTelegram', () => {
  it('returns { ok: false } when env vars are missing — no fetch call', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '')
    vi.stubEnv('TELEGRAM_CHAT_ID', '')

    const { sendTelegram } = await import('../notifications')
    const fetchSpy = vi.spyOn(global, 'fetch')
    const result = await sendTelegram('Hello')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('channel not configured')
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns { ok: false } when Telegram API returns non-2xx — does not throw', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token')
    vi.stubEnv('TELEGRAM_CHAT_ID', 'test-chat-id')

    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('{"ok":false,"error_code":401,"description":"Unauthorized"}', {
        status: 401,
      })
    )

    const { sendTelegram } = await import('../notifications')
    const result = await sendTelegram('Hello')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('telegram_401')
    }
  })

  it('returns { ok: true } on success', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token')
    vi.stubEnv('TELEGRAM_CHAT_ID', 'test-chat-id')

    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('{"ok":true}', { status: 200 })
    )

    const { sendTelegram } = await import('../notifications')
    const result = await sendTelegram('Hello')
    expect(result.ok).toBe(true)
  })
})

// ── sendEmail ─────────────────────────────────────────────

describe('sendEmail', () => {
  it('returns { ok: false } when env vars are missing — no Resend call', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('RESEND_FROM_EMAIL', '')

    const { sendEmail } = await import('../notifications')
    const result = await sendEmail('to@example.com', 'Subject', '<p>Body</p>')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('channel not configured')
    }
  })

  it('returns { ok: false } on Resend error — does not throw', async () => {
    vi.stubEnv('RESEND_API_KEY', 'resend-key')
    vi.stubEnv('RESEND_FROM_EMAIL', 'from@example.com')

    // Make mockSend return an error response
    mockSend.mockResolvedValueOnce({
      error: { message: 'API Error', name: 'validation_error' },
      data: null,
    })

    const { sendEmail } = await import('../notifications')
    const result = await sendEmail('to@example.com', 'Subject', '<p>Body</p>')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('resend:')
    }
  })

  it('returns { ok: true } on success', async () => {
    vi.stubEnv('RESEND_API_KEY', 'resend-key')
    vi.stubEnv('RESEND_FROM_EMAIL', 'from@example.com')

    // Make mockSend return a success response (default behavior)
    mockSend.mockResolvedValueOnce({ error: null, data: { id: 'msg-id' } })

    const { sendEmail } = await import('../notifications')
    const result = await sendEmail('to@example.com', 'Subject', '<p>Body</p>')

    expect(result.ok).toBe(true)
  })
})
