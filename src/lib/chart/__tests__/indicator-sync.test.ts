// odd/tasks/chart-pro-redesign.md S2: which indicators are on, hidden or minimized lives in the account, so the
// phone and the computer show the same set. The chart store stays this device's copy: the first paint and
// offline use read it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { IndicatorKey } from '@/lib/store/chart-store'

const PREFS_KEY = 'warren:chart-preferences'
const STORE_KEY = 'tv-gratis-chart-state'
const KEYS: IndicatorKey[] = ['ema20', 'ema50', 'ema200', 'rsi', 'macd', 'volume', 'bollinger', 'obv', 'stochastic', 'adx']
type Flags = Record<IndicatorKey, boolean>
const NONE = Object.fromEntries(KEYS.map((k) => [k, false])) as Flags
/** Today's factory set: every indicator on but Bollinger and OBV. */
const FACTORY: Flags = { ...NONE, ema20: true, ema50: true, ema200: true, rsi: true, macd: true, volume: true, stochastic: true, adx: true }

type Reply = { status: number; body?: unknown } | 'offline'
let replies: Reply[]
const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
  const next = replies.length > 1 ? replies.shift()! : replies[0]
  if (next === 'offline') throw new TypeError('Failed to fetch')
  return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status })
})
const patches = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([, init]) => JSON.parse(String(init!.body)))
const account = (indicatorSettings: object): Reply => ({ status: 200, body: { userId: 'u1', preferences: { favorites: {}, toolStyles: {}, indicatorSettings } } })
const saved = (): Reply => ({ status: 204 })
/** Every indicator's entry: on as in `on`, hidden and minimized as given (none by default). */
const entries = (on: Flags, hidden = NONE, minimized = NONE) =>
  Object.fromEntries(KEYS.map((k) => [k, { on: on[k], hidden: hidden[k], minimized: minimized[k] }]))

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
  const { startIndicatorSync } = await import('../indicator-sync')
  stop = startIndicatorSync()
  return useChartStore
}
const settle = () => vi.advanceTimersByTimeAsync(0)
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms)

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
  it("saves this device's set, all ten indicators with their values kept, once", async () => {
    const device = { indicators: { ...FACTORY, obv: true, rsi: false }, hidden: { ...NONE, macd: true }, minimized: { ...NONE, adx: true } }
    const store = await openTab(device, account({ rsi: { values: { rsi: 21 } } }), saved())
    await settle()
    await wait(800)

    const all = entries(device.indicators, device.hidden, device.minimized)
    expect(patches()).toEqual([{ indicatorSettings: { ...all, rsi: { values: { rsi: 21 }, ...all.rsi } } }])
    expect(store.getState().indicators).toEqual(device.indicators)
    await wait(60_000)
    expect(patches()).toHaveLength(1)

    // The next tab finds them in the account and saves nothing.
    fetchMock.mockClear()
    await openTab(null, account(all), saved())
    await settle()
    await wait(60_000)
    expect(patches()).toEqual([])
  })

  it('a new user on a new device starts with the factory set, eight on, and the account gets it', async () => {
    const store = await openTab(null, account({}), saved())
    await settle()
    await wait(800)

    expect(store.getState().indicators).toEqual(FACTORY)
    expect(patches()).toEqual([{ indicatorSettings: entries(FACTORY) }])
  })
})

describe("the account's set", () => {
  it('shows here once it answers, over this device\'s copy, and nothing is saved back', async () => {
    const on = { ...NONE, ema20: true, obv: true, bollinger: true, rsi: true, macd: true }
    const store = await openTab({ indicators: FACTORY }, account(entries(on, { ...NONE, rsi: true }, { ...NONE, macd: true })), saved())
    expect(store.getState().indicators).toEqual(FACTORY) // the first paint: this device's copy

    await settle()
    const s = store.getState()
    expect([s.indicators, s.hidden, s.minimized]).toEqual([on, { ...NONE, rsi: true }, { ...NONE, macd: true }])
    expect(JSON.parse(stored[STORE_KEY]).state.indicators).toEqual(on) // the next first paint
    await wait(60_000)
    expect(patches()).toEqual([])
  })

  it('an indicator this version does not know is ignored', async () => {
    const store = await openTab(null, account({ ...entries({ ...FACTORY, rsi: false }), sma: { on: true, hidden: false, minimized: false } }), saved())
    await settle()

    expect(Object.keys(store.getState().indicators).sort()).toEqual([...KEYS].sort())
    expect(store.getState().indicators.rsi).toBe(false)
    await wait(60_000)
    expect(patches()).toEqual([])
  })
})

describe('a change here', () => {
  it('saves that indicator alone, its whole entry: its values and style go with it', async () => {
    const rsi = { values: { rsi: 21 }, style: { lines: { rsi: { color: '#f23645' } } }, on: true, hidden: false, minimized: false }
    const store = await openTab(null, account({ ...entries(FACTORY), rsi }), saved())
    await settle()

    store.getState().toggleHidden('rsi')
    await wait(800)
    expect(patches()).toEqual([{ indicatorSettings: { rsi: { ...rsi, hidden: true } } }])

    store.getState().toggleMinimized('macd')
    await wait(800)
    expect(patches().at(-1)).toEqual({ indicatorSettings: { macd: { on: true, hidden: false, minimized: true } } })

    store.getState().removeIndicator('macd')
    await wait(800)
    expect(patches().at(-1)).toEqual({ indicatorSettings: { macd: { on: false, hidden: false, minimized: false } } })
  })

  it('two quick toggles of one indicator send one save, with where it ended', async () => {
    const store = await openTab(null, account(entries(FACTORY)), saved())
    await settle()

    store.getState().toggleIndicator('obv')
    await wait(100)
    store.getState().toggleHidden('obv')
    await wait(800)

    expect(patches()).toEqual([{ indicatorSettings: { obv: { on: true, hidden: true, minimized: false } } }])
  })

  it.each<[string, Reply]>([['offline', 'offline'], ['signed out (401)', { status: 401 }]])(
    "%s: this device's set stays; a change waits on the device and goes once the account answers",
    async (_, failure) => {
      const device = { ...FACTORY, obv: true }
      const store = await openTab({ indicators: device }, failure, account(entries(FACTORY)), saved())
      await wait(60_000)
      expect(store.getState().indicators).toEqual(device)
      expect(patches()).toEqual([])

      store.getState().toggleHidden('rsi')
      expect(JSON.parse(stored[PREFS_KEY]).pending).toEqual({ indicatorSettings: { rsi: { on: true, hidden: true, minimized: false } } })

      await wait(800) // the save finds no account yet and asks for it again; this time it answers
      await wait(800)
      expect(patches()).toEqual([{ indicatorSettings: { rsi: { on: true, hidden: true, minimized: false } } }])
      expect(store.getState().hidden.rsi).toBe(true) // the change made here wins
      expect(store.getState().indicators.obv).toBe(false) // the rest is the account's
    },
  )
})
