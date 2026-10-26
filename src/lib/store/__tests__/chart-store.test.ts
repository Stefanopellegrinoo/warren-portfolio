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
