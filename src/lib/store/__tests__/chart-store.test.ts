// The chart's per-device state: the trades switch is on from the start, and a device's state from
// before it keeps working.
import { describe, it, expect, vi } from 'vitest'

// Node 25 ships a stub localStorage without methods; the persisted chart store needs a real one.
const data = vi.hoisted(() => {
  const data = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) },
  })
  return data
})

const { useChartStore } = await import('../chart-store')
const KEY = 'tv-gratis-chart-state'

describe('chart store: Mostrar operaciones', () => {
  it('is on from the start', () => {
    expect(useChartStore.getState().showTrades).toBe(true)
  })

  it('a device saved before the switch keeps what it had, with the trades on', async () => {
    const old = useChartStore.getState()
    data.set(KEY, JSON.stringify({ state: { symbol: 'GGAL', timeframe: '1w', indicators: { ...old.indicators, obv: true }, hidden: old.hidden, config: old.config, watchlist: ['GGAL'], activeWatchlistId: null, showPortfolioOverlay: false }, version: 0 }))

    await useChartStore.persist.rehydrate()

    const s = useChartStore.getState()
    expect([s.symbol, s.timeframe, s.indicators.obv, s.showPortfolioOverlay]).toEqual(['GGAL', '1w', true, false])
    expect(s.showTrades).toBe(true)
  })

  it('turning it off is kept on this device', async () => {
    useChartStore.getState().toggleShowTrades()

    expect(useChartStore.getState().showTrades).toBe(false)
    expect(JSON.parse(data.get(KEY)!).state.showTrades).toBe(false)

    await useChartStore.persist.rehydrate()
    expect(useChartStore.getState().showTrades).toBe(false)
  })
})

describe('chart store: comparisons', () => {
  it('start empty', () => {
    expect(useChartStore.getState().compareSymbols).toEqual([])
  })

  it('keep each asset once and at most five', () => {
    useChartStore.getState().setCompareSymbols(['A', 'B', 'A', 'C', 'D', 'E', 'F'])
    expect(useChartStore.getState().compareSymbols).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('are kept on this device', async () => {
    useChartStore.getState().setCompareSymbols(['SPY', '__portfolio__'])
    expect(JSON.parse(data.get(KEY)!).state.compareSymbols).toEqual(['SPY', '__portfolio__'])

    await useChartStore.persist.rehydrate()
    expect(useChartStore.getState().compareSymbols).toEqual(['SPY', '__portfolio__'])
  })
})

describe('chart store: the range comparisons start from', () => {
  it('starts at one year and is kept on this device', async () => {
    expect(useChartStore.getState().compareRange).toBe('1A')

    useChartStore.getState().setCompareRange('6M')
    expect(JSON.parse(data.get(KEY)!).state.compareRange).toBe('6M')

    await useChartStore.persist.rehydrate()
    expect(useChartStore.getState().compareRange).toBe('6M')
  })
})

// odd/tasks/chart-pro-redesign.md S1: a minimized pane keeps its indicator on; S2: kept like hidden is.
describe('chart store: minimized panes', () => {
  it('start open, and a device saved before them keeps working with every pane open', async () => {
    const old = useChartStore.getState()
    data.set(KEY, JSON.stringify({ state: { indicators: old.indicators, hidden: { ...old.hidden, rsi: true } }, version: 0 }))

    await useChartStore.persist.rehydrate()

    const s = useChartStore.getState()
    expect(Object.values(s.minimized).every((m) => m === false)).toBe(true)
    expect(Object.keys(s.minimized).sort()).toEqual(Object.keys(s.hidden).sort())
    expect(s.hidden.rsi).toBe(true)
  })

  it('minimizing keeps the indicator on and is kept on this device, next to hidden', async () => {
    useChartStore.setState({ indicators: { ...useChartStore.getState().indicators, macd: true } })
    useChartStore.getState().toggleMinimized('macd')

    expect(useChartStore.getState().minimized.macd).toBe(true)
    expect(useChartStore.getState().indicators.macd).toBe(true)
    expect(JSON.parse(data.get(KEY)!).state.minimized.macd).toBe(true)
    await useChartStore.persist.rehydrate()
    expect(useChartStore.getState().minimized.macd).toBe(true)

    useChartStore.getState().toggleMinimized('macd')
    expect(useChartStore.getState().minimized.macd).toBe(false)
  })

  it('turning an indicator on opens its pane, as it shows it; turning it off keeps both as they were (as before)', () => {
    const s = () => useChartStore.getState()
    useChartStore.setState({ indicators: { ...s().indicators, adx: true }, hidden: { ...s().hidden, adx: true }, minimized: { ...s().minimized, adx: true } })

    s().toggleIndicator('adx')
    expect([s().indicators.adx, s().hidden.adx, s().minimized.adx]).toEqual([false, true, true])
    s().toggleIndicator('adx')
    expect([s().indicators.adx, s().hidden.adx, s().minimized.adx]).toEqual([true, false, false])
  })

  it('removing an indicator opens its pane for next time, as it shows it', () => {
    const s = () => useChartStore.getState()
    useChartStore.setState({ hidden: { ...s().hidden, obv: true }, minimized: { ...s().minimized, obv: true } })

    s().removeIndicator('obv')

    expect([s().indicators.obv, s().hidden.obv, s().minimized.obv]).toEqual([false, false, false])
  })
})
