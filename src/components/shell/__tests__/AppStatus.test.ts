// odd/tasks/ux-base-global.md S5: the user is told when the connection drops and comes back,
// and when a new version of the app took over the open page.
import { describe, it, expect } from 'vitest'
import { watchAppStatus, registerServiceWorker } from '../AppStatus'

function fakeWindow({ onLine = true, controlled = false } = {}) {
  const serviceWorker = Object.assign(new EventTarget(), { controller: controlled ? {} : null })
  return Object.assign(new EventTarget(), { navigator: { onLine, serviceWorker } }) as unknown as Window & {
    navigator: { serviceWorker: EventTarget }
  }
}

describe('watchAppStatus', () => {
  it('reports a dropped and a restored connection', () => {
    const win = fakeWindow()
    const seen: string[] = []
    watchAppStatus(win, n => seen.push(n))
    win.dispatchEvent(new Event('offline'))
    win.dispatchEvent(new Event('online'))
    expect(seen).toEqual(['offline', 'online'])
  })

  it('reports being offline when the page opens without connection', () => {
    const seen: string[] = []
    watchAppStatus(fakeWindow({ onLine: false }), n => seen.push(n))
    expect(seen).toEqual(['offline'])
  })

  it('announces a new version only when an older one was running the page', () => {
    const updated = fakeWindow({ controlled: true })
    const firstInstall = fakeWindow({ controlled: false })
    const seen: string[] = []
    watchAppStatus(updated, n => seen.push(`updated:${n}`))
    watchAppStatus(firstInstall, n => seen.push(`first:${n}`))
    updated.navigator.serviceWorker.dispatchEvent(new Event('controllerchange'))
    firstInstall.navigator.serviceWorker.dispatchEvent(new Event('controllerchange'))
    expect(seen).toEqual(['updated:update'])
  })

  it('stops listening after cleanup', () => {
    const win = fakeWindow({ controlled: true })
    const seen: string[] = []
    watchAppStatus(win, n => seen.push(n))()
    win.dispatchEvent(new Event('offline'))
    win.navigator.serviceWorker.dispatchEvent(new Event('controllerchange'))
    expect(seen).toEqual([])
  })
})

describe('registerServiceWorker', () => {
  it('registers the worker next-pwa builds, for the whole app', async () => {
    const calls: unknown[][] = []
    await registerServiceWorker({ serviceWorker: { register: async (...args: unknown[]) => { calls.push(args) } } } as unknown as Navigator)
    expect(calls).toEqual([['/sw.js', { scope: '/' }]])
  })

  it('does nothing in a browser without service workers', async () => {
    await expect(registerServiceWorker({} as Navigator)).resolves.toBeUndefined()
  })

  it('keeps the app working when registration fails', async () => {
    const nav = { serviceWorker: { register: async () => { throw new Error('blocked') } } } as unknown as Navigator
    await expect(registerServiceWorker(nav)).resolves.toBeUndefined()
  })
})
