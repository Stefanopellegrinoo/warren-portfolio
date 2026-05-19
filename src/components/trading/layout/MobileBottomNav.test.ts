import { describe, it, expect } from 'vitest'
import { getTabConfig, isActiveView } from './MobileBottomNav'

describe('getTabConfig', () => {
  it('returns correct config for chart view', () => {
    const config = getTabConfig('chart')
    expect(config).toEqual({ label: 'Chart', icon: 'TrendingUp' })
  })

  it('returns correct config for watchlist view', () => {
    const config = getTabConfig('watchlist')
    expect(config).toEqual({ label: 'Watchlist', icon: 'Star' })
  })
})

describe('isActiveView', () => {
  it('returns true when view equals activeView', () => {
    expect(isActiveView('chart', 'chart')).toBe(true)
    expect(isActiveView('watchlist', 'watchlist')).toBe(true)
  })

  it('returns false when view does not equal activeView', () => {
    expect(isActiveView('chart', 'watchlist')).toBe(false)
    expect(isActiveView('watchlist', 'chart')).toBe(false)
  })
})
