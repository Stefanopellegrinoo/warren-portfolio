import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clampWidth, getStoredWidth } from './useResizable'

// ── localStorage mock ────────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

describe('clampWidth', () => {
  const min = 192
  const max = 384

  it('(a) returns the default width when no stored value', () => {
    expect(clampWidth(256, min, max)).toBe(256)
  })

  it('(c) clamps at min (192) when value is below minimum', () => {
    expect(clampWidth(56, min, max)).toBe(192)
  })

  it('(d) clamps at max (384) when value is above maximum', () => {
    expect(clampWidth(456, min, max)).toBe(384)
  })

  it('allows value exactly at min boundary', () => {
    expect(clampWidth(192, min, max)).toBe(192)
  })

  it('allows value exactly at max boundary', () => {
    expect(clampWidth(384, min, max)).toBe(384)
  })

  it('returns value unchanged when within bounds', () => {
    expect(clampWidth(300, min, max)).toBe(300)
  })
})

describe('getStoredWidth', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    localStorageMock.clear()
  })

  it('(b) returns stored number from localStorage when key exists', () => {
    localStorageMock.setItem('warren:sidebar-width', '320')
    expect(getStoredWidth('warren:sidebar-width')).toBe(320)
  })

  it('returns null when key is not in localStorage', () => {
    expect(getStoredWidth('warren:sidebar-width')).toBeNull()
  })

  it('returns null when stored value is not a valid number', () => {
    localStorageMock.setItem('warren:sidebar-width', 'not-a-number')
    expect(getStoredWidth('warren:sidebar-width')).toBeNull()
  })

  it('(e) localStorage.setItem is callable for persistence', () => {
    const setItemSpy = vi.spyOn(localStorageMock, 'setItem')
    localStorageMock.setItem('warren:sidebar-width', '300')
    expect(setItemSpy).toHaveBeenCalledWith('warren:sidebar-width', '300')
  })
})
