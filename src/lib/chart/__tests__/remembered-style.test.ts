// odd/tasks/chart-customization.md S2: a new drawing comes out with the style last chosen for its tool
// (user: "Salga igual"); "Volver al de fábrica" resets it. S8: saved drawings keep their own style.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DEFAULT_STYLE, factoryStyleFor, type DrawingManager } from 'lightweight-charts-drawing'
import { fakeChart } from './fake-chart'
import { applyRememberedStyles, resetToFactory, restyle } from '../remembered-style'
import { getPreferences, setToolStyle } from '../preferences'
import { TOOL_KINDS } from '../preferences-schema'

const CHANNEL = [{ time: 100, price: 150 }, { time: 200, price: 180 }, { time: 150, price: 120 }]
const LINE = [{ time: 100, price: 150 }, { time: 200, price: 180 }]

let manager: DrawingManager
let off: () => void
const draw = (kind: string, points = LINE, extra = {}) => manager.get(manager.add({ kind, points, ...extra } as never))!

beforeEach(() => {
  // The account is not there (migration 051 not applied): the tab works on its own copy.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
  manager = fakeChart().manager
  off = applyRememberedStyles()
})
afterEach(() => {
  off()
  TOOL_KINDS.forEach((kind) => setToolStyle(kind, null))
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('the style a new drawing comes out with', () => {
  it('is the style remembered for its tool, over the factory one', () => {
    setToolStyle('parallel-channel', { color: '#f23645', fillBackground: false })

    expect(draw('parallel-channel', CHANNEL).style).toEqual({ ...factoryStyleFor('parallel-channel'), color: '#f23645', fillBackground: false })
  })

  it("is the library's factory style for a tool with nothing remembered", () => {
    setToolStyle('parallel-channel', { color: '#f23645' })

    expect(draw('trend-line').style).toEqual(factoryStyleFor('trend-line'))
  })

  it('goes back to the factory style when the chart goes away', () => {
    setToolStyle('trend-line', { color: '#f23645' })
    off()

    expect(draw('trend-line').style).toEqual(factoryStyleFor('trend-line'))
  })

  it('never reaches a saved drawing: an imported one keeps its style, or the old fallback without one', () => {
    setToolStyle('trend-line', { color: '#f23645', width: 4 })
    const saved = { color: '#089981', width: 1, lineStyle: 'dotted' }

    manager.importJSON([
      { id: 'a', kind: 'trend-line', points: LINE, style: saved },
      { id: 'b', kind: 'trend-line', points: LINE },
    ])

    expect(manager.get('a')!.style).toEqual(saved)
    expect(manager.get('b')!.style).toEqual(DEFAULT_STYLE)
  })
})

describe('remembering', () => {
  it('a restyled drawing changes, and its tool remembers what differs from the factory', () => {
    const d = draw('parallel-channel', CHANNEL)

    restyle(manager, [d], () => ({ fillBackground: false, backgroundColor: '#ff9800' }))

    expect(manager.get(d.id)!.style).toMatchObject({ fillBackground: false, backgroundColor: '#ff9800' })
    expect(getPreferences().toolStyles['parallel-channel']).toEqual({ fillBackground: false, backgroundColor: '#ff9800' })
    // "Salga igual": the next channel comes out the same.
    expect(draw('parallel-channel', CHANNEL).style).toEqual(manager.get(d.id)!.style)
  })

  it("does not remember what belongs to one drawing: its text, a position's stop and target", () => {
    const d = draw('long-position', [LINE[0]], { style: { ...factoryStyleFor('long-position'), stopLevel: 3, profitLevel: 6, text: 'Entrada' } })

    restyle(manager, [d], () => ({ stopColor: '#9c27b0' }))

    expect(getPreferences().toolStyles['long-position']).toEqual({ stopColor: '#9c27b0' })
  })

  it('a style back at the factory one leaves nothing remembered', () => {
    const d = draw('trend-line')
    restyle(manager, [d], () => ({ color: '#f23645' }))

    restyle(manager, [manager.get(d.id)!], () => ({ color: factoryStyleFor('trend-line').color }))

    expect(getPreferences().toolStyles['trend-line']).toBeUndefined()
  })
})

describe('Volver al de fábrica', () => {
  it('puts the drawing and its tool back on the factory style, keeping what is its own', () => {
    setToolStyle('long-position', { stopColor: '#9c27b0', targetColor: '#2962ff' })
    const d = draw('long-position', [LINE[0]], { style: { ...factoryStyleFor('long-position'), stopColor: '#9c27b0', stopLevel: 3, profitLevel: 6 } })

    resetToFactory(manager, d)

    expect(manager.get(d.id)!.style).toEqual({ ...factoryStyleFor('long-position'), stopLevel: 3, profitLevel: 6 })
    expect(getPreferences().toolStyles['long-position']).toBeUndefined()
    expect(draw('long-position', [LINE[0]]).style).toEqual(factoryStyleFor('long-position'))
  })
})
