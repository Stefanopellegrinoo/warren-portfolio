// odd/tasks/chart-pro-redesign.md S2: which indicators are on, hidden or minimized lives in the account, so the
// phone and the computer show the same set. It is kept apart from each indicator's saved settings: no change of
// visibility, in any order or state, may touch an indicator's values or style. The chart store stays this
// device's copy: the first paint and offline use read it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { IndicatorKey } from '@/lib/store/chart-store'

const PREFS_KEY = 'warren:chart-preferences'
const STORE_KEY = 'tv-gratis-chart-state'
const KEYS: IndicatorKey[] = ['ema20', 'ema50', 'ema200', 'rsi', 'macd', 'volume', 'bollinger', 'obv', 'stochastic', 'adx']
type Flags = Record<IndicatorKey, boolean>
const NONE = Object.fromEntries(KEYS.map((k) => [k, false])) as Flags
/** Today's factory set: every indicator on but Bollinger and OBV. */
const FACTORY: Flags = { ...NONE, ema20: true, ema50: true, ema200: true, rsi: true, macd: true, volume: true, stochastic: true, adx: true }
/** RSI's settings as the previous build saved them: values and style only. */
const RSI_OLD = { values: { rsi: 21 }, style: { lines: { rsi: { color: '#f23645', width: 2 } }, levels: [{ value: 25 }, { value: 75 }] } }

type Reply = { status: number; body?: unknown } | 'offline'
let replies: Reply[]
const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
  const next = replies.length > 1 ? replies.shift()! : replies[0]
  if (next === 'offline') throw new TypeError('Failed to fetch')
  return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status })
})
const patches = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([, init]) => JSON.parse(String(init!.body)))
const account = (indicatorVisibility: object, indicatorSettings: object = {}): Reply =>
  ({ status: 200, body: { userId: 'u1', preferences: { favorites: {}, toolStyles: {}, indicatorSettings, indicatorVisibility } } })
const saved = (): Reply => ({ status: 204 })
/** Every indicator's visibility: on as in `on`, hidden and minimized as given (none by default). */
const visibility = (on: Flags, hidden = NONE, minimized = NONE) =>
  Object.fromEntries(KEYS.map((k) => [k, { on: on[k], hidden: hidden[k], minimized: minimized[k] }]))
const hash = (v: unknown) => JSON.stringify(v)

let stored: Record<string, string>
const storage = {
  getItem: (key: string) => stored[key] ?? null,
  setItem: (key: string, value: string) => { stored[key] = value },
  removeItem: (key: string) => { delete stored[key] },
}
let stop: (() => void) | null = null

/** A new tab of the Trading page: fresh modules over what this device stored, the sync started as the page does. */
async function openTab(device: { indicators: Flags; hidden?: Flags; minimized?: Flags } | null, ...r: Reply[]) {
  stop?.()
  replies = r
  if (device) stored[STORE_KEY] = JSON.stringify({ state: { hidden: NONE, minimized: NONE, ...device }, version: 0 })
  vi.resetModules()
  const { useChartStore } = await import('@/lib/store/chart-store')
  const prefs = await import('../preferences')
  const { startIndicatorSync } = await import('../indicator-sync')
  stop = startIndicatorSync()
  return { store: useChartStore, prefs }
}
const settle = () => vi.advanceTimersByTimeAsync(0)
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms)
/** What another tab of this browser does: write the device copy, which this tab hears as a storage event. */
const otherTabWrote = (copy: unknown) => {
  stored[PREFS_KEY] = JSON.stringify(copy)
  window.dispatchEvent(new StorageEvent('storage', { key: PREFS_KEY }))
}

beforeEach(() => {
  vi.useFakeTimers()
  stored = {}
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('localStorage', storage)
})
afterEach(() => {
  stop?.()
  stop = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the first time the account answers after this shipped', () => {
  it("saves this device's set, all ten indicators, once, and leaves their settings alone", async () => {
    const device = { indicators: { ...FACTORY, obv: true, rsi: false }, hidden: { ...NONE, macd: true }, minimized: { ...NONE, adx: true } }
    const { store, prefs } = await openTab(device, account({}, { rsi: RSI_OLD }), saved())
    await settle()
    await wait(800)

    const all = visibility(device.indicators, device.hidden, device.minimized)
    expect(patches()).toEqual([{ indicatorVisibility: all }])
    expect(store.getState().indicators).toEqual(device.indicators)
    expect(hash(prefs.getPreferences().indicatorSettings.rsi)).toBe(hash(RSI_OLD))
    await wait(60_000)
    expect(patches()).toHaveLength(1)

    // The next tab finds them in the account and saves nothing.
    fetchMock.mockClear()
    await openTab(null, account(all, { rsi: RSI_OLD }), saved())
    await settle()
    await wait(60_000)
    expect(patches()).toEqual([])
  })

  it('a new user on a new device starts with the factory set, eight on, and the account gets it', async () => {
    const { store } = await openTab(null, account({}), saved())
    await settle()
    await wait(800)

    expect(store.getState().indicators).toEqual(FACTORY)
    expect(patches()).toEqual([{ indicatorVisibility: visibility(FACTORY) }])
  })

  it('an account missing some indicators (one added later) gets only those', async () => {
    const { adx: _adx, obv: _obv, ...eight } = visibility({ ...FACTORY, rsi: false })
    const { store } = await openTab({ indicators: { ...FACTORY, obv: true } }, account(eight), saved())
    await settle()
    await wait(800)

    expect(patches()).toEqual([{ indicatorVisibility: { adx: { on: true, hidden: false, minimized: false }, obv: { on: true, hidden: false, minimized: false } } }])
    expect(store.getState().indicators.rsi).toBe(false)
  })
})

describe("the account's set", () => {
  it("shows here once it answers, over this device's copy, and nothing is saved back", async () => {
    const on = { ...NONE, ema20: true, obv: true, bollinger: true, rsi: true, macd: true }
    const { store } = await openTab({ indicators: FACTORY }, account(visibility(on, { ...NONE, rsi: true }, { ...NONE, macd: true })), saved())
    expect(store.getState().indicators).toEqual(FACTORY) // the first paint: this device's copy

    await settle()
    const s = store.getState()
    expect([s.indicators, s.hidden, s.minimized]).toEqual([on, { ...NONE, rsi: true }, { ...NONE, macd: true }])
    expect(JSON.parse(stored[STORE_KEY]).state.indicators).toEqual(on) // the next first paint
    await wait(60_000)
    expect(patches()).toEqual([])
  })

  it("another tab's change shows here, and nothing is saved back", async () => {
    const { store } = await openTab({ indicators: FACTORY }, account(visibility(FACTORY)), saved())
    await settle()

    const copy = JSON.parse(stored[PREFS_KEY])
    otherTabWrote({ ...copy, preferences: { ...copy.preferences, indicatorVisibility: { ...copy.preferences.indicatorVisibility, obv: { on: true, hidden: false, minimized: false } } } })
    await wait(60_000)

    expect(store.getState().indicators.obv).toBe(true)
    expect(patches()).toEqual([])
  })

  it('an indicator this version does not know is ignored', async () => {
    const { store } = await openTab(null, account({ ...visibility({ ...FACTORY, rsi: false }), sma: { on: true, hidden: false, minimized: false } }), saved())
    await settle()

    expect(Object.keys(store.getState().indicators).sort()).toEqual([...KEYS].sort())
    expect(store.getState().indicators.rsi).toBe(false)
    await wait(60_000)
    expect(patches()).toEqual([])
  })
})

describe('a change here', () => {
  it("saves that indicator's visibility alone, never its settings", async () => {
    const { store, prefs } = await openTab(null, account(visibility(FACTORY), { rsi: RSI_OLD }), saved())
    await settle()

    store.getState().toggleHidden('rsi')
    await wait(800)
    expect(patches()).toEqual([{ indicatorVisibility: { rsi: { on: true, hidden: true, minimized: false } } }])

    store.getState().toggleMinimized('macd')
    await wait(800)
    expect(patches().at(-1)).toEqual({ indicatorVisibility: { macd: { on: true, hidden: false, minimized: true } } })

    store.getState().removeIndicator('macd')
    await wait(800)
    expect(patches().at(-1)).toEqual({ indicatorVisibility: { macd: { on: false, hidden: false, minimized: false } } })
    expect(hash(prefs.getPreferences().indicatorSettings.rsi)).toBe(hash(RSI_OLD))
  })

  it('two quick toggles of one indicator send one save, with where it ended', async () => {
    const { store } = await openTab(null, account(visibility(FACTORY)), saved())
    await settle()

    store.getState().toggleIndicator('obv')
    await wait(100)
    store.getState().toggleHidden('obv')
    await wait(800)

    expect(patches()).toEqual([{ indicatorVisibility: { obv: { on: true, hidden: true, minimized: false } } }])
  })

  it.each<[string, Reply]>([['offline', 'offline'], ['signed out (401)', { status: 401 }]])(
    "%s: this device's set stays; a change waits on the device and goes once the account answers",
    async (_, failure) => {
      const device = { ...FACTORY, obv: true }
      const { store } = await openTab({ indicators: device }, failure, account(visibility(FACTORY)), saved())
      await wait(60_000)
      expect(store.getState().indicators).toEqual(device)
      expect(patches()).toEqual([])

      store.getState().toggleHidden('rsi')
      expect(JSON.parse(stored[PREFS_KEY]).pending).toEqual({ indicatorVisibility: { rsi: { on: true, hidden: true, minimized: false } } })

      await wait(800) // the save finds no account yet and asks for it again; this time it answers
      await wait(800)
      expect(patches()).toEqual([{ indicatorVisibility: { rsi: { on: true, hidden: true, minimized: false } } }])
      expect(store.getState().hidden.rsi).toBe(true) // the change made here wins
      expect(store.getState().indicators.obv).toBe(false) // the rest is the account's
    },
  )
})

// Found by the verifier (P8, P8b, P8c, P9): a visibility change made before the account answered, or a device copy
// rewritten by an older build, used to erase the values and style another device saved for that indicator.
describe("the settings another device saved survive", () => {
  const accountRsi = () => account(visibility(FACTORY), { rsi: RSI_OLD })
  const noSettingsSent = () => expect(patches().filter((p) => 'indicatorSettings' in p)).toEqual([])

  it('P8: hiding RSI offline on a new device', async () => {
    const { store, prefs } = await openTab(null, 'offline', accountRsi(), saved())
    await settle()
    store.getState().toggleHidden('rsi')
    await wait(800) // the save asks for the account again: now it answers
    await wait(800)

    expect(patches()).toEqual([{ indicatorVisibility: { rsi: { on: true, hidden: true, minimized: false } } }])
    noSettingsSent()
    expect(hash(prefs.getPreferences().indicatorSettings.rsi)).toBe(hash(RSI_OLD))
  })

  it('P8b: minimizing RSI offline on a device whose copy predates the other device saving it', async () => {
    await openTab({ indicators: FACTORY }, account(visibility(FACTORY)), saved()) // loaded once, RSI unsaved then
    await settle()
    await wait(60_000)
    fetchMock.mockClear()

    const { store, prefs } = await openTab(null, 'offline', accountRsi(), saved())
    await settle()
    store.getState().toggleMinimized('rsi')
    await wait(800)
    await wait(800)

    noSettingsSent()
    expect(hash(prefs.getPreferences().indicatorSettings.rsi)).toBe(hash(RSI_OLD))
    expect(prefs.getPreferences().indicatorVisibility.rsi).toEqual({ on: true, hidden: false, minimized: true })
  })

  it("P8c: minimizing RSI on a new device while the account's first answer is on its way", async () => {
    const slow = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return new Response(null, { status: 204 })
      await new Promise((r) => setTimeout(r, 500))
      return new Response(JSON.stringify((accountRsi() as { body: unknown }).body), { status: 200 })
    })
    vi.stubGlobal('fetch', slow)
    const { store, prefs } = await openTab(null, saved())
    await wait(200)
    store.getState().toggleMinimized('rsi')
    await wait(400)
    await wait(1600)

    const sent = slow.mock.calls.filter(([, i]) => i?.method === 'PATCH').map(([, i]) => JSON.parse(String(i!.body)))
    expect(sent).toEqual([{ indicatorVisibility: { rsi: { on: true, hidden: false, minimized: true } } }])
    expect(hash(prefs.getPreferences().indicatorSettings.rsi)).toBe(hash(RSI_OLD))
  })

  it("P9: a tab of an older build rewrites this browser's copy without them, as it may during a deploy", async () => {
    const { store } = await openTab({ indicators: FACTORY }, accountRsi(), saved())
    await settle()
    await wait(60_000)
    fetchMock.mockClear()

    const copy = JSON.parse(stored[PREFS_KEY])
    otherTabWrote({ owner: copy.owner, preferences: { favorites: { ray: true }, toolStyles: {}, indicatorSettings: {} }, pending: { favorites: { ray: true } } })
    await wait(800)
    await wait(800)

    noSettingsSent()
    expect(patches().filter((p) => 'indicatorVisibility' in p)).toEqual([])
    expect(store.getState().indicators).toEqual(FACTORY)
  })

  it('an entry saved by the previous build, values and style only, stays byte-identical through every visibility path', async () => {
    // first upload, the account's set shown, a toggle, another tab's change, an offline toggle in the next tab
    const { store, prefs } = await openTab({ indicators: FACTORY }, account({}, { rsi: RSI_OLD }), saved())
    await settle()
    await wait(800)
    store.getState().toggleHidden('rsi')
    await wait(800)
    const copy = JSON.parse(stored[PREFS_KEY])
    otherTabWrote({ ...copy, preferences: { ...copy.preferences, indicatorVisibility: { ...copy.preferences.indicatorVisibility, rsi: { on: false, hidden: false, minimized: false } } } })
    await wait(800)
    expect(store.getState().indicators.rsi).toBe(false)
    expect(hash(prefs.getPreferences().indicatorSettings.rsi)).toBe(hash(RSI_OLD))

    const next = await openTab(null, 'offline', account(visibility(FACTORY), { rsi: RSI_OLD }), saved())
    await settle()
    next.store.getState().toggleMinimized('rsi')
    await wait(800)
    await wait(800)

    noSettingsSent()
    expect(hash(next.prefs.getPreferences().indicatorSettings.rsi)).toBe(hash(RSI_OLD))
    expect(hash(JSON.parse(stored[PREFS_KEY]).preferences.indicatorSettings.rsi)).toBe(hash(RSI_OLD))
  })
})
