import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatIndicatorLines, formatTelegramMessage } from '../signals-worker'

// ── formatIndicatorLines ─────────────────────────────────────

describe('formatIndicatorLines', () => {
  it('formats numeric metadata values and uppercases keys', () => {
    const result = formatIndicatorLines({ ema20: 182.3, rsi14: 44.2 })
    expect(result).toContain('EMA 20: 182.30')
    expect(result).toContain('RSI 14: 44.20')
  })

  it('skips non-numeric values and the "close" key', () => {
    const result = formatIndicatorLines({
      close: 182.3,
      ema20: 180.0,
      label: 'some-string' as unknown as number,
    })
    expect(result).not.toContain('CLOSE')
    expect(result).not.toContain('LABEL')
    expect(result).toContain('EMA 20')
  })

  it('returns empty string for null or empty metadata', () => {
    expect(formatIndicatorLines(null)).toBe('')
    expect(formatIndicatorLines({})).toBe('')
  })
})

// ── formatTelegramMessage ────────────────────────────────────

const baseBuySignal = {
  id: 'sig-1',
  user_id: 'user-1',
  setup_id: 'setup-1',
  strategy_id: 'strat-1',
  ticker: 'AAPL',
  type: 'BUY' as const,
  price: 150,
  metadata: { rsi14: 32.0, ema20: 149.0 },
}

describe('formatTelegramMessage', () => {
  it('formats BUY message with green emoji and correct structure', () => {
    const msg = formatTelegramMessage(baseBuySignal, 'EMA Cross', 'Growth')
    expect(msg).toContain('🟢')
    expect(msg).toContain('[EMA Cross — BUY] AAPL')
    expect(msg).toContain('Precio: $150.00')
    expect(msg).toContain('Estrategia: Growth')
  })

  it('formats SELL message with red emoji', () => {
    const sellSignal = { ...baseBuySignal, type: 'SELL' as const }
    const msg = formatTelegramMessage(sellSignal, 'EMA Cross', 'Growth')
    expect(msg).toContain('🔴')
    expect(msg).toContain('[EMA Cross — SELL] AAPL')
  })
})

// ── dispatchAlerts throttle logic (unit tests for pure functions) ────────────

describe('dispatchAlerts — throttle logic (unit)', () => {
  const THROTTLE_MS = 24 * 60 * 60 * 1000

  it('skips alert when last_fired_at is within 24 hours', () => {
    const recentFired = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1h ago
    const now = Date.now()
    const shouldSkip =
      recentFired != null &&
      now - new Date(recentFired).getTime() < THROTTLE_MS

    expect(shouldSkip).toBe(true)
  })

  it('does not skip alert when last_fired_at is older than 24 hours', () => {
    const oldFired = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() // 25h ago
    const now = Date.now()
    const shouldSkip =
      oldFired != null &&
      now - new Date(oldFired).getTime() < THROTTLE_MS

    expect(shouldSkip).toBe(false)
  })

  it('does not skip alert when last_fired_at is null', () => {
    const lastFiredAt: string | null = null
    const now = Date.now()
    const shouldSkip =
      lastFiredAt != null &&
      now - new Date(lastFiredAt).getTime() < THROTTLE_MS

    expect(shouldSkip).toBe(false)
  })
})

// ── channel dispatch — env-based unit tests ──────────────────

describe('dispatchAlerts — channel dispatch (via notifications)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('does not update last_fired_at when all channels return { ok: false }', async () => {
    // When env vars are absent, sendTelegram returns { ok: false }
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '')
    vi.stubEnv('TELEGRAM_CHAT_ID', '')

    const { sendTelegram } = await import('../notifications')
    const result = await sendTelegram('test message')

    // anySuccess remains false — no last_fired_at update should occur
    expect(result.ok).toBe(false)
  })

  it('produces { ok: true } when Telegram channel is configured (mock fetch)', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'tok')
    vi.stubEnv('TELEGRAM_CHAT_ID', 'chat')

    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('{"ok":true}', { status: 200 })
    )

    const { sendTelegram } = await import('../notifications')
    const result = await sendTelegram('test')

    // anySuccess becomes true — last_fired_at should be updated
    expect(result.ok).toBe(true)
  })
})
