/**
 * Web Push to a user's devices (the installed app). Like notifications.ts it never throws and uses
 * relative imports only, because the worker loads it too.
 */
import webpush from 'web-push'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isPushEndpoint } from './push-endpoint'

/** What the service worker shows: worker/index.js reads these fields. */
export interface PushPayload {
  title: string
  body: string
  /** Page the notification opens when tapped. */
  url: string
  /** A newer notification with the same tag replaces the older one. */
  tag?: string
}

export type PushResult = { ok: true; sent: number } | { ok: false; error: string }

/** The VAPID keys from the runtime env, or null when push is not configured. */
export function pushKeys(): { subject: string; publicKey: string; privateKey: string } | null {
  const { VAPID_SUBJECT: subject, VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = process.env
  return subject && publicKey && privateKey ? { subject, publicKey, privateKey } : null
}

/** How long a push service keeps an undelivered notification: an alert an hour later is still news. */
const TTL_SECONDS = 60 * 60

/** Sends the payload to every device of the user and deletes the ones the push service says are gone. */
export async function sendPushToUser(supabase: SupabaseClient, userId: string, payload: PushPayload): Promise<PushResult> {
  const vapidDetails = pushKeys()
  if (!vapidDetails) return { ok: false, error: 'push not configured' }

  const { data, error } = await supabase.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', userId)
  if (error) return { ok: false, error: error.message }
  if (!data?.length) return { ok: false, error: 'no devices' }

  const body = JSON.stringify(payload)
  const gone: string[] = []
  let sent = 0
  await Promise.all(data.filter(s => isPushEndpoint(s.endpoint)).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { vapidDetails, TTL: TTL_SECONDS })
      sent++
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      // 404 and 410: the app was removed or notifications turned off on that device.
      if (status === 404 || status === 410) gone.push(s.id)
      else console.error('[push] send failed', status ?? err)
    }
  }))
  if (gone.length) await supabase.from('push_subscriptions').delete().in('id', gone)
  return sent ? { ok: true, sent } : { ok: false, error: 'no device accepted the push' }
}
