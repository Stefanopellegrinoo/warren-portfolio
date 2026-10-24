// odd/tasks/push-notificaciones.md S2: "Avisos en este dispositivo" turns push on and off from a tap,
// says how to install the app when it cannot, and every failure says what happened.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { toast } from 'sonner'
import { PushSettings } from '../PushSettings'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const APPLE = 'https://web.push.apple.com/QGuQyavXutnMH'
const KEY = 'BPk'
const JSON_SUB = { endpoint: APPLE, keys: { p256dh: 'BKey', auth: 'secret' } }

type Env = { standalone?: boolean; iphone?: boolean; push?: boolean; permission?: NotificationPermission; subscribed?: boolean; subscribe?: () => Promise<unknown> }
function browser({ standalone = true, iphone = true, push = true, permission = 'default', subscribed = false, subscribe }: Env = {}) {
  const subscription = { endpoint: APPLE, toJSON: () => JSON_SUB, unsubscribe: vi.fn(async () => { current = null; return true }) }
  let current: typeof subscription | null = subscribed ? subscription : null
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(subscribe ?? (async () => { current = subscription; return subscription })),
  }
  vi.stubGlobal('navigator', {
    userAgent: iphone ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' : 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130',
    standalone,
    maxTouchPoints: iphone ? 5 : 0,
    ...(push ? { serviceWorker: { ready: Promise.resolve({ pushManager }) } } : {}),
  })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('standalone') && standalone }))
  if (push) {
    vi.stubGlobal('PushManager', function PushManager() {})
    vi.stubGlobal('Notification', { permission })
  } else {
    vi.stubGlobal('PushManager', undefined)
  }
  return { pushManager, subscription }
}

function server(over: Record<string, () => Response> = {}) {
  const calls: { url: string; method: string; body?: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const hit = over[`${method} ${url}`]
    if (hit) return hit()
    if (method === 'GET' && url === '/api/push') return Response.json({ publicKey: KEY })
    if (method === 'POST' && url === '/api/push') return Response.json({ ok: true }, { status: 201 })
    if (method === 'DELETE' && url === '/api/push') return new Response(null, { status: 204 })
    if (method === 'POST' && url === '/api/push/test') return Response.json({ sent: 1 })
    throw new Error(`unexpected ${method} ${url}`)
  }))
  return calls
}

async function mount() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<PushSettings />) })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  const click = async (text: string) => {
    await act(async () => { [...el.querySelectorAll('button')].find(b => b.textContent === text)!.click() })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
  const has = (text: string) => [...el.querySelectorAll('button')].some(b => b.textContent === text)
  return { el, click, has, unmount: () => act(() => root.unmount()) }
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); document.body.innerHTML = '' })

describe('PushSettings', () => {
  it('on an iPhone outside the installed app, says how to install it and offers no button', async () => {
    browser({ standalone: false, push: false })
    server()
    const { el, has, unmount } = await mount()
    expect(el.textContent).toContain('agregá Warren a la pantalla de inicio (Compartir → Agregar a inicio) y abrila desde ahí')
    expect(has('Activar avisos')).toBe(false)
    unmount()
  })

  it('"Activar avisos" asks the browser on the tap and saves this device', async () => {
    const { pushManager } = browser()
    const calls = server()
    const { el, click, has, unmount } = await mount()
    expect(el.textContent).toContain('Te avisamos con una notificación cuando se dispara una alerta.')
    await click('Activar avisos')
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1)
    const options = (pushManager.subscribe.mock.calls[0] as unknown[])[0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array }
    expect(options.userVisibleOnly).toBe(true)
    expect([...options.applicationServerKey]).toEqual([0x04, 0xf9])
    expect(calls.find(c => c.method === 'POST' && c.url === '/api/push')?.body).toEqual(JSON_SUB)
    expect(toast.success).toHaveBeenCalledWith('Avisos activados en este dispositivo')
    expect(el.textContent).toContain('Este dispositivo recibe los avisos.')
    expect(has('Enviar una prueba')).toBe(true)
    unmount()
  })

  it('a device the server could not save is unsubscribed again and says why', async () => {
    const { subscription } = browser()
    server({ 'POST /api/push': () => Response.json({ error: 'Este navegador no ofrece notificaciones compatibles.' }, { status: 400 }) })
    const { el, click, has, unmount } = await mount()
    await click('Activar avisos')
    expect(toast.error).toHaveBeenCalledWith('Este navegador no ofrece notificaciones compatibles.')
    expect(subscription.unsubscribe).toHaveBeenCalled()
    expect(has('Activar avisos')).toBe(true)
    expect(el.textContent).not.toContain('Este dispositivo recibe los avisos.')
    unmount()
  })

  it('a refused permission explains how to allow it in the settings', async () => {
    browser({ subscribe: async () => { vi.stubGlobal('Notification', { permission: 'denied' }); throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }) } })
    server()
    const { el, click, has, unmount } = await mount()
    await click('Activar avisos')
    expect(el.textContent).toContain('Bloqueaste los avisos de Warren.')
    expect(has('Activar avisos')).toBe(false)
    unmount()
  })

  it('when the server has no keys yet, says so instead of offering the button', async () => {
    browser()
    server({ 'GET /api/push': () => Response.json({ error: 'Los avisos todavía no están configurados en el servidor.' }, { status: 503 }) })
    const { el, has, unmount } = await mount()
    expect(el.textContent).toContain('Los avisos todavía no están configurados en el servidor.')
    expect(has('Activar avisos')).toBe(false)
    unmount()
  })

  it('"Enviar una prueba" asks the server to send one, and a failure says why', async () => {
    browser({ subscribed: true, permission: 'granted' })
    const calls = server()
    const { click, unmount } = await mount()
    await click('Enviar una prueba')
    expect(calls.some(c => c.method === 'POST' && c.url === '/api/push/test')).toBe(true)
    expect(toast.success).toHaveBeenCalledWith('Te mandamos una prueba: debería llegarte en unos segundos.')
    unmount()

    browser({ subscribed: true, permission: 'granted' })
    server({ 'POST /api/push/test': () => Response.json({ error: 'No se pudo enviar la prueba. Probá de nuevo en un rato.' }, { status: 502 }) })
    const again = await mount()
    await again.click('Enviar una prueba')
    expect(toast.error).toHaveBeenCalledWith('No se pudo enviar la prueba. Probá de nuevo en un rato.')
    again.unmount()
  })

  it('"Desactivar" forgets this device on the server and in the browser', async () => {
    const { subscription } = browser({ subscribed: true, permission: 'granted' })
    const calls = server()
    const { click, has, unmount } = await mount()
    await click('Desactivar')
    expect(calls.find(c => c.method === 'DELETE')?.body).toEqual({ endpoint: APPLE })
    expect(subscription.unsubscribe).toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Avisos desactivados en este dispositivo')
    expect(has('Activar avisos')).toBe(true)
    unmount()
  })

  it('without connection, says so in Spanish', async () => {
    browser({ subscribed: true, permission: 'granted' })
    server({ 'POST /api/push/test': () => { throw new TypeError('Failed to fetch') } })
    const { click, unmount } = await mount()
    await click('Enviar una prueba')
    expect(toast.error).toHaveBeenCalledWith('No hay conexión. Revisá tu internet y probá de nuevo.')
    unmount()
  })
})
