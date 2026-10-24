'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'

type Notice = 'offline' | 'online' | 'update'

/**
 * Registers the worker next-pwa builds into public/sw.js. next-pwa only injects its own registration
 * into the Pages Router entry, which App Router pages never load (next.config.js `register: false`).
 */
export async function registerServiceWorker(nav: Navigator): Promise<void> {
  if (!nav.serviceWorker) return
  try {
    await nav.serviceWorker.register('/sw.js', { scope: '/' })
  } catch (err) {
    // The app works without it, only without the offline page and the cached assets.
    console.warn('[pwa] service worker not registered:', err)
  }
}

/** Wires the connection and new-version notices to `notify`; returns the cleanup. */
export function watchAppStatus(win: Window, notify: (notice: Notice) => void): () => void {
  const onOffline = () => notify('offline')
  const onOnline = () => notify('online')
  win.addEventListener('offline', onOffline)
  win.addEventListener('online', onOnline)
  if (win.navigator.onLine === false) notify('offline')

  // next-pwa activates a new worker at once (skipWaiting + clientsClaim). A page an older worker
  // controlled keeps running the old code, so it is told; a first install is not an update.
  const sw = win.navigator.serviceWorker
  const wasControlled = Boolean(sw?.controller)
  const onControllerChange = () => { if (wasControlled) notify('update') }
  sw?.addEventListener('controllerchange', onControllerChange)

  return () => {
    win.removeEventListener('offline', onOffline)
    win.removeEventListener('online', onOnline)
    sw?.removeEventListener('controllerchange', onControllerChange)
  }
}

// One toast id per topic, so "volvió la conexión" replaces "sin conexión" instead of stacking.
const NOTICES: Record<Notice, () => void> = {
  offline: () => toast.warning('Sin conexión', {
    id: 'connection', duration: Infinity,
    description: 'Los datos no se actualizan hasta que vuelva internet.',
  }),
  // Same id updates the toast in place and keeps any field not given, so the description is explicit.
  online: () => toast.success('Volvió la conexión', {
    id: 'connection', duration: 4000,
    description: 'Los datos se vuelven a actualizar.',
  }),
  update: () => toast('Hay una versión nueva de Warren', {
    id: 'update', duration: Infinity,
    description: 'Recargá para usarla.',
    action: { label: 'Recargar', onClick: () => window.location.reload() },
  }),
}

/** Mounted once in the root layout: registers the worker and tells the user when the connection or the app version changes. */
export default function AppStatus() {
  useEffect(() => {
    // Development serves no worker (next-pwa `disable`), and a stale one would fight hot reload.
    if (process.env.NODE_ENV === 'production') void registerServiceWorker(navigator)
    return watchAppStatus(window, notice => NOTICES[notice]())
  }, [])
  return null
}
