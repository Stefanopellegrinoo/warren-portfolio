import { z } from 'zod'
import { isPushEndpoint } from '@/lib/push-endpoint'

const UNSUPPORTED = 'Este navegador no ofrece notificaciones compatibles.'

/** The answer when the server has no VAPID keys yet. */
export const PUSH_NOT_CONFIGURED = 'Los avisos todavía no están configurados en el servidor.'

// Schema for POST /api/push: a browser's PushSubscription as toJSON() gives it.
export const PushSubscriptionSchema = z.object({
  endpoint: z.string({ message: UNSUPPORTED }).max(2000, { message: UNSUPPORTED }).refine(isPushEndpoint, { message: UNSUPPORTED }),
  keys: z.object({
    p256dh: z.string({ message: UNSUPPORTED }).min(1, { message: UNSUPPORTED }).max(200, { message: UNSUPPORTED }),
    auth: z.string({ message: UNSUPPORTED }).min(1, { message: UNSUPPORTED }).max(100, { message: UNSUPPORTED }),
  }, { message: UNSUPPORTED }),
})

// Schema for DELETE /api/push: the device to forget.
export const PushUnsubscribeSchema = z.object({
  endpoint: z.string({ message: UNSUPPORTED }).min(1, { message: UNSUPPORTED }).max(2000, { message: UNSUPPORTED }),
})
