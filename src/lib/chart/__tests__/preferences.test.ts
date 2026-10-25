// odd/tasks/chart-customization.md S4: this tab's copy of the account's chart preferences. It loads once,
// applies a change at once, saves it debounced, and keeps working with the device's values when the API fails.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const KEY = 'warren:chart-preferences'
const ACCOUNT = { favorites: { ray: true }, toolStyles: { ray: { color: '#f23645' } }, indicatorSettings: {} }

type Reply = { status: number; body?: unknown } | 'offline'
let replies: Reply[]
const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
  const next = replies.length > 1 ? replies.shift()! : replies[0]
  if (next === 'offline') throw new TypeError('Failed to fetch')
  return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status })
})
const gets = () => fetchMock.mock.calls.filter(([, init]) => !init?.method)
const patches = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([, init]) => JSON.parse(String(init!.body)))
const ok = (preferences = ACCOUNT, userId = 'u1'): Reply => ({ status: 200, body: { userId, preferences } })
const saved = (): Reply => ({ status: 204 })

/** A new tab: the module starts from scratch, with whatever this device stored. */
async function openTab(...r: Reply[]) {
  replies = r
  vi.resetModules()
  const prefs = await import('../preferences')
  const seen = vi.fn()
  prefs.subscribe(seen)
  return { prefs, seen }
}
const settle = () => vi.advanceTimersByTimeAsync(0)

// The device's storage (Node's own localStorage shadows jsdom's, so the tests bring one).
let stored: Record<string, string>
const storage = {
  getItem: (key: string) => stored[key] ?? null,
  setItem: (key: string, value: string) => { stored[key] = value },
}
const device = () => JSON.parse(stored[KEY] ?? 'null')
const keep = (value: unknown) => { stored[KEY] = JSON.stringify(value) }

beforeEach(() => {
  vi.useFakeTimers()
  stored = {}
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('localStorage', storage)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('loading', () => {
  it('asks the account once per tab, however many components subscribe', async () => {
    const { prefs, seen } = await openTab(ok())
    prefs.subscribe(() => {})
    prefs.subscribe(() => {})
    await settle()
    expect(gets()).toHaveLength(1)
    expect(gets()[0][0]).toBe('/api/chart-preferences')
    expect(prefs.getPreferences()).toEqual(ACCOUNT)
    expect(seen).toHaveBeenCalled()
    expect(device()).toEqual({ owner: 'u1', preferences: ACCOUNT, pending: {} })
  })

  it("shows this device's last values at once, then the account's", async () => {
    keep({ owner: 'u1', preferences: { favorites: { rectangle: true } }, pending: {} })
    const { prefs } = await openTab(ok())
    expect(prefs.getPreferences().favorites).toEqual({ rectangle: true })
    await settle()
    expect(prefs.getPreferences()).toEqual(ACCOUNT)
  })

  it('a device copy that is not valid is ignored, not trusted', async () => {
    keep({ owner: 'u1', preferences: { favorites: { 'gann-fan': true }, toolStyles: { ray: { color: 'nope' } } }, pending: { favorites: { nope: true } } })
    const { prefs } = await openTab({ status: 500 })
    await settle()
    expect(prefs.getPreferences()).toEqual({ favorites: {}, toolStyles: {}, indicatorSettings: {} })
  })
})

describe('changing a preference', () => {
  it('applies at once and saves the burst once, debounced, per key', async () => {
    const { prefs, seen } = await openTab(ok(), saved())
    await settle()
    seen.mockClear()

    prefs.setFavorite('rectangle', true)
    prefs.setFavorite('ray', false)
    prefs.setToolStyle('ray', { color: '#2962ff', width: 2 })
    prefs.setIndicatorSettings('rsi', { values: { rsi: 21 } })

    expect(prefs.getPreferences()).toEqual({
      favorites: { rectangle: true },
      toolStyles: { ray: { color: '#2962ff', width: 2 } },
      indicatorSettings: { rsi: { values: { rsi: 21 } } },
    })
    expect(seen).toHaveBeenCalledTimes(4)
    expect(patches()).toEqual([])

    await vi.advanceTimersByTimeAsync(799)
    expect(patches()).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(patches()).toEqual([{
      favorites: { rectangle: true, ray: null },
      toolStyles: { ray: { color: '#2962ff', width: 2 } },
      indicatorSettings: { rsi: { values: { rsi: 21 } } },
    }])
    await settle()
    expect(device().pending).toEqual({})
  })

  it('a reset removes the remembered entry and saves a null for it', async () => {
    const { prefs } = await openTab(ok(), saved())
    await settle()
    prefs.setToolStyle('ray', null)
    expect(prefs.getPreferences().toolStyles).toEqual({})
    await vi.advanceTimersByTimeAsync(800)
    expect(patches()).toEqual([{ toolStyles: { ray: null } }])
  })

  it('an entry the account would refuse is not applied nor sent', async () => {
    const { prefs } = await openTab(ok(), saved())
    await settle()
    prefs.setToolStyle('ray', { color: 'not-a-color' })
    await vi.advanceTimersByTimeAsync(800)
    expect(prefs.getPreferences()).toEqual(ACCOUNT)
    expect(patches()).toEqual([])
  })

  it('a change made while the account is still loading survives its answer', async () => {
    const { prefs } = await openTab(ok(), saved())
    prefs.setFavorite('text', true)
    await settle()
    expect(prefs.getPreferences().favorites).toEqual({ ray: true, text: true })
    await vi.advanceTimersByTimeAsync(800)
    expect(patches()).toEqual([{ favorites: { text: true } }])
  })

  it('the pending change goes at once, with keepalive, when the app is hidden', async () => {
    const { prefs } = await openTab(ok(), saved())
    await settle()
    prefs.setFavorite('rectangle', true)
    window.dispatchEvent(new Event('pagehide'))
    expect(patches()).toEqual([{ favorites: { rectangle: true } }])
    expect(fetchMock.mock.calls.at(-1)![1]!.keepalive).toBe(true)
  })
})

describe('when the API fails', () => {
  it("the table missing: this device's values keep working, no error, and nothing is asked again on its own", async () => {
    keep({ owner: 'u1', preferences: { favorites: { rectangle: true } }, pending: {} })
    const { prefs } = await openTab({ status: 500, body: { error: 'No se pudo completar la operación' } })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(prefs.getPreferences().favorites).toEqual({ rectangle: true })

    // A change applies locally and is kept on the device; it retries the load once, never a PATCH blind.
    prefs.setFavorite('ray', true)
    expect(prefs.getPreferences().favorites).toEqual({ rectangle: true, ray: true })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(gets()).toHaveLength(2)
    expect(patches()).toEqual([])
    expect(device().pending).toEqual({ favorites: { ray: true } })
  })

  it('a failed save is kept and goes with the next change, never in a loop', async () => {
    const { prefs } = await openTab(ok(), { status: 500 }, saved())
    await settle()
    prefs.setFavorite('rectangle', true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(patches()).toHaveLength(1)
    expect(device().pending).toEqual({ favorites: { rectangle: true } })

    prefs.setFavorite('text', true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(patches()).toEqual([{ favorites: { rectangle: true } }, { favorites: { rectangle: true, text: true } }])
    expect(device().pending).toEqual({})
  })

  it('a save the account refuses (400) is dropped: it would never pass', async () => {
    const { prefs } = await openTab(ok(), { status: 400 }, saved())
    await settle()
    prefs.setFavorite('rectangle', true)
    await vi.advanceTimersByTimeAsync(800)
    prefs.setFavorite('text', true)
    await vi.advanceTimersByTimeAsync(800)
    expect(patches()).toEqual([{ favorites: { rectangle: true } }, { favorites: { text: true } }])
  })

  it('a change made offline is sent by the next tab that reaches the account', async () => {
    const first = await openTab('offline')
    await settle()
    first.prefs.setFavorite('rectangle', true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(patches()).toEqual([])

    fetchMock.mockClear()
    const next = await openTab(ok(), saved())
    await settle()
    expect(next.prefs.getPreferences().favorites).toEqual({ ray: true, rectangle: true })
    await vi.advanceTimersByTimeAsync(800)
    expect(patches()).toEqual([{ favorites: { rectangle: true } }])
  })

  it("another account's pending changes on this device are never sent to this one", async () => {
    keep({ owner: 'someone-else', preferences: { favorites: { rectangle: true } }, pending: { favorites: { rectangle: true } } })
    const { prefs } = await openTab(ok(), saved())
    await vi.advanceTimersByTimeAsync(60_000)
    expect(prefs.getPreferences()).toEqual(ACCOUNT)
    expect(patches()).toEqual([])
    expect(device()).toEqual({ owner: 'u1', preferences: ACCOUNT, pending: {} })
  })

  it('works in memory when the device storage throws', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => { throw new Error('QuotaExceededError') },
    })
    const { prefs } = await openTab(ok(), saved())
    await settle()
    prefs.setFavorite('rectangle', true)
    expect(prefs.getPreferences().favorites).toEqual({ ray: true, rectangle: true })
    await vi.advanceTimersByTimeAsync(800)
    expect(patches()).toEqual([{ favorites: { rectangle: true } }])
  })
})
