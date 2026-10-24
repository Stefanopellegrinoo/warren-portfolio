// Push notifications of the installed app (odd/tasks/push-notificaciones.md S1). next-pwa bundles this
// file into the service worker in production builds; the payload comes from src/lib/push.ts.

const HOME = '/dashboard'

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(self.registration.showNotification(data.title || 'Warren', {
    body: data.body || '',
    tag: data.tag,
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    data: { url: data.url || HOME },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // A notification only opens pages of this app, whatever URL the payload carries.
  const url = new URL((event.notification.data && event.notification.data.url) || HOME, self.location.origin)
  const target = url.origin === self.location.origin ? url.href : self.location.origin + HOME
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
    if (!open) return self.clients.openWindow(target)
    await open.focus()
    try {
      // navigate() exists only for windows this worker controls.
      return await open.navigate(target)
    } catch {
      return self.clients.openWindow(target)
    }
  })())
})
