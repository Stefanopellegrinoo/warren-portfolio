/**
 * Notification transport layer — pure I/O, never throws.
 *
 * Worker context: relative imports only — no @/ aliases.
 * All functions return { ok: boolean; error?: string } and catch all errors internally.
 */

import { Resend } from 'resend'

export type SendResult = { ok: true } | { ok: false; error: string }

export interface NotificationConfigStatus {
  telegram: boolean
  email: boolean
}

/**
 * Check which notification channels are configured and log their status.
 * Call at worker startup — never throws.
 */
export function checkNotificationConfig(): NotificationConfigStatus {
  const telegram = Boolean(
    process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID
  )
  const email = Boolean(
    process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL
  )

  if (!telegram) {
    console.warn(
      '[notifications] Telegram disabled — TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing'
    )
  } else {
    console.log('[notifications] Telegram enabled')
  }

  if (!email) {
    console.warn(
      '[notifications] Email disabled — RESEND_API_KEY / RESEND_FROM_EMAIL missing'
    )
  } else {
    console.log('[notifications] Email enabled')
  }

  return { telegram, email }
}

/**
 * Send a message via Telegram Bot API.
 * Returns { ok: false } when env vars are missing — no network call is made.
 */
export async function sendTelegram(message: string): Promise<SendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!token || !chatId) {
    console.warn('[notifications] sendTelegram: channel not configured')
    return { ok: false, error: 'channel not configured' }
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      }
    )

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return {
        ok: false,
        error: `telegram_${res.status}:${body.slice(0, 200)}`,
      }
    }

    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: `telegram_fetch:${(err as Error).message}`,
    }
  }
}

// Lazy Resend singleton — created only when env vars are present
let resendClient: Resend | null = null

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  if (!resendClient) resendClient = new Resend(key)
  return resendClient
}

/**
 * Send an email via Resend.
 * Returns { ok: false } when env vars are missing — no network call is made.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<SendResult> {
  const client = getResend()
  const from = process.env.RESEND_FROM_EMAIL

  if (!client || !from) {
    console.warn('[notifications] sendEmail: channel not configured')
    return { ok: false, error: 'channel not configured' }
  }

  try {
    const { error } = await client.emails.send({ from, to, subject, html })
    if (error) {
      return { ok: false, error: `resend:${error.message}` }
    }
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: `email_send:${(err as Error).message}`,
    }
  }
}
