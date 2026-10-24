// odd/tasks/push-notificaciones.md S1: the service worker shows the push the server sent and, on tap,
// opens its page inside the app. worker/index.js runs in the service worker, so it is run here against
// a stand-in `self`.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const code = readFileSync(path.resolve(__dirname, '../../../worker/index.js'), 'utf8')
const ORIGIN = 'https://warren.example'

function worker(windows: { url: string; focus: () => Promise<unknown>; navigate?: (u: string) => Promise<unknown> }[] = []) {
  const listeners: Record<string, (e: unknown) => void> = {}
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn },
    registration: { showNotification: vi.fn(async () => {}) },
    clients: { matchAll: vi.fn(async () => windows), openWindow: vi.fn(async () => null) },
  }
  new Function('self', code)(self)
  const fire = async (type: string, event: Record<string, unknown>) => {
    let done: Promise<unknown> = Promise.resolve()
    listeners[type]({ ...event, waitUntil: (p: Promise<unknown>) => { done = p } })
    await done
  }
  return { self, fire }
}

const pushEvent = (payload: unknown) => ({ data: { json: () => payload, text: () => String(payload) } })
const clickEvent = (url?: string) => ({ notification: { close: vi.fn(), data: url ? { url } : undefined } })

describe('push', () => {
  it('shows the title, body and tag the server sent, and keeps the page to open', async () => {
    const { self, fire } = worker()
    await fire('push', pushEvent({ title: 'Alerta de precio: AAPL', body: 'Cruzó hacia arriba 180', url: '/trading?symbol=AAPL', tag: 'alert-1' }))
    expect(self.registration.showNotification).toHaveBeenCalledWith('Alerta de precio: AAPL', {
      body: 'Cruzó hacia arriba 180', tag: 'alert-1', icon: '/icon-192x192.png', badge: '/icon-192x192.png', data: { url: '/trading?symbol=AAPL' },
    })
  })

  it('a push without a readable payload still shows a Warren notification', async () => {
    const { self, fire } = worker()
    await fire('push', { data: null })
    expect(self.registration.showNotification).toHaveBeenCalledWith('Warren', expect.objectContaining({ body: '', data: { url: '/dashboard' } }))
  })
})

describe('notificationclick', () => {
  it('brings the open app to the front on the notification page', async () => {
    const win = { url: `${ORIGIN}/dashboard`, focus: vi.fn(async () => {}), navigate: vi.fn(async () => {}) }
    const { self, fire } = worker([win])
    const event = clickEvent('/trading?symbol=AAPL')
    await fire('notificationclick', event)
    expect(event.notification.close).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
    expect(win.navigate).toHaveBeenCalledWith(`${ORIGIN}/trading?symbol=AAPL`)
    expect(self.clients.openWindow).not.toHaveBeenCalled()
  })

  it('opens the app on that page when it is not open, or when the open window cannot navigate', async () => {
    const closed = worker()
    await closed.fire('notificationclick', clickEvent('/trading?symbol=AAPL'))
    expect(closed.self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/trading?symbol=AAPL`)

    const stuck = worker([{ url: `${ORIGIN}/dashboard`, focus: vi.fn(async () => {}), navigate: vi.fn(async () => { throw new TypeError('not controlled') }) }])
    await stuck.fire('notificationclick', clickEvent('/strategies?tab=alertas'))
    expect(stuck.self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/strategies?tab=alertas`)
  })

  it('never leaves the app: a page on another site opens the summary instead', async () => {
    const { self, fire } = worker()
    await fire('notificationclick', clickEvent('https://evil.example/phish'))
    expect(self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/dashboard`)
  })
})
