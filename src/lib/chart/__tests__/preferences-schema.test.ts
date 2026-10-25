// odd/tasks/chart-customization.md S4: the account accepts exactly the app's tools and indicators.
import { describe, it, expect } from 'vitest'
import { factoryStyleFor } from 'lightweight-charts-drawing'
import { TOOL_LABELS } from '@/components/trading/chart/DrawingTools'
import { INDICATOR_COLORS } from '@/lib/store/chart-store'
import { INDICATOR_KEYS, TOOL_KINDS, parsePatch, parsePreferences } from '../preferences-schema'

describe('preferences schema', () => {
  it('knows the tools of the Dibujar list, in its order', () => {
    expect([...TOOL_KINDS]).toEqual(Object.keys(TOOL_LABELS))
  })

  it("knows every indicator of the chart store", () => {
    expect([...INDICATOR_KEYS].sort()).toEqual(Object.keys(INDICATOR_COLORS).sort())
  })

  it("accepts every tool's factory style from the drawing library as a remembered style", () => {
    for (const kind of TOOL_KINDS) {
      expect(parsePatch({ toolStyles: { [kind]: factoryStyleFor(kind) } }), kind).not.toBeNull()
    }
  })

  it('drops a stored entry with a "__proto__" field instead of inheriting its unchecked values', () => {
    const stored = JSON.parse('{"toolStyles": {"ray": {"__proto__": {"color": "javascript:1"}}, "text": {"color": "#fff"}}}')
    const prefs = parsePreferences(stored)
    expect(prefs.toolStyles).toEqual({ text: { color: '#fff' } })
    expect(prefs.toolStyles.ray?.color).toBeUndefined()
  })
})
