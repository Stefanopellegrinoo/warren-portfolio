// odd/tasks/chart-customization.md S3: where the favorites bar sits and whether it shows are kept per
// device, and the bar always stays inside the chart.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clampBar, readBar, saveBar } from '../favorites-bar'
import { memoryStorage } from './memory-storage'

beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()) })
afterEach(() => { vi.unstubAllGlobals() })

const BAR = { width: 46, height: 160 }
const AREA = { width: 390, height: 600 }

describe('clampBar', () => {
  it('leaves a position inside the chart where it is', () => {
    expect(clampBar({ x: 100, y: 200 }, BAR, AREA)).toEqual({ x: 100, y: 200 })
  })

  it('brings a position past any edge back inside the chart', () => {
    expect(clampBar({ x: 5000, y: -40 }, BAR, AREA)).toEqual({ x: 390 - 46 - 4, y: 4 })
    expect(clampBar({ x: -10, y: 900 }, BAR, AREA)).toEqual({ x: 4, y: 600 - 160 - 4 })
  })

  it('pins the bar to the top-left when the chart is smaller than the bar', () => {
    expect(clampBar({ x: 30, y: 30 }, BAR, { width: 40, height: 100 })).toEqual({ x: 4, y: 4 })
  })
})

describe('the bar kept on the device', () => {
  it('shows, at no saved position, on a device that never set it', () => {
    expect(readBar()).toEqual({ shown: true, position: null })
  })

  it('keeps the switch and the position apart', () => {
    saveBar({ position: { x: 12, y: 80 } })
    saveBar({ shown: false })

    expect(readBar()).toEqual({ shown: false, position: { x: 12, y: 80 } })
  })

  it('ignores a broken copy', () => {
    localStorage.setItem('warren:chart-favorites-bar', '{"shown":"no","position":{"x":"1","y":null}}')
    expect(readBar()).toEqual({ shown: true, position: null })
    localStorage.setItem('warren:chart-favorites-bar', 'not json')
    expect(readBar()).toEqual({ shown: true, position: null })
  })

  it('works without storage (private mode, blocked site data)', () => {
    const blocked = () => { throw new Error('blocked') }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked })

    expect(() => saveBar({ shown: false })).not.toThrow()
    expect(readBar()).toEqual({ shown: true, position: null })
  })
})
