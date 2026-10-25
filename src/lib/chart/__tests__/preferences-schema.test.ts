// odd/tasks/chart-customization.md S4: the account accepts exactly the app's tools and indicators.
import { describe, it, expect } from 'vitest'
import { factoryStyleFor } from 'lightweight-charts-drawing'
import { TOOL_LABELS } from '@/components/trading/chart/DrawingTools'
import { DEFAULT_CONFIG, INDICATOR_COLORS } from '@/lib/store/chart-store'
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

describe('preferences schema, nesting', () => {
  // A 10 KB body can nest 5000 levels: the check must refuse it, not overflow the stack (a 500).
  const deep = JSON.parse('{"a":' + '['.repeat(30000) + ']'.repeat(30000) + '}')

  it('refuses a deeply nested style as a bad request instead of throwing', () => {
    expect(() => parsePatch({ toolStyles: { ray: deep } })).not.toThrow()
    expect(parsePatch({ toolStyles: { ray: deep } })).toBeNull()
  })

  it('drops a deeply nested stored entry instead of throwing', () => {
    expect(parsePreferences({ toolStyles: { ray: deep, text: { color: '#2962ff' } } }).toolStyles).toEqual({ text: { color: '#2962ff' } })
  })
})

// odd/tasks/chart-customization.md S5: an indicator's style holds exactly the parts the settings sheet edits.
describe('preferences schema, indicator style', () => {
  const style = (key: string, value: unknown) => parsePatch({ indicatorSettings: { [key]: { style: value } } })

  it("names every line of every indicator by the id the chart draws it with", async () => {
    const { INDICATOR_SPECS } = await import('../indicator-specs')
    const { INDICATOR_STYLE_PARTS } = await import('../preferences-schema')
    for (const key of INDICATOR_KEYS) {
      const lines = INDICATOR_SPECS[key].lines([], DEFAULT_CONFIG)
      const parts = INDICATOR_STYLE_PARTS[key]
      expect(lines.filter((l) => l.type === 'line').map((l) => l.id), key).toEqual([...(parts.lines ?? [])])
      expect(lines.filter((l) => l.type === 'histogram').map((l) => l.id), key).toEqual([...(parts.histograms ?? [])])
    }
  })

  it('accepts per-line color, width and visibility, histogram up/down colors, RSI levels and fills', () => {
    expect(style('ema20', { lines: { ema20: { color: '#f23645', width: 3, visible: false } } })).not.toBeNull()
    expect(style('macd', { lines: { macd: { width: 2 }, histogram: { upColor: '#089981', downColor: '#f23645', visible: true } } })).not.toBeNull()
    expect(style('volume', { lines: { volume: { upColor: '#089981', downColor: '#f23645' } } })).not.toBeNull()
    expect(style('rsi', { levels: [{ value: 20, color: '#089981' }, { value: 80, visible: false }], fills: { levels: { visible: true, color: '#7e57c2', transparency: 85 } } })).not.toBeNull()
    expect(style('bollinger', { fills: { bands: { visible: true } } })).not.toBeNull()
  })

  it.each([
    ['enabled inside style', 'rsi', { enabled: true }],
    ['hidden inside style', 'rsi', { hidden: true }],
    ['a line of another indicator', 'ema20', { lines: { rsi: { color: '#f23645' } } }],
    ['a width on a histogram', 'macd', { lines: { histogram: { width: 2 } } }],
    ['up/down colors on a line', 'macd', { lines: { signal: { upColor: '#f23645' } } }],
    ['a width over 4', 'obv', { lines: { obv: { width: 5 } } }],
    ['levels on an indicator without editable levels', 'stochastic', { levels: [{ value: 20 }] }],
    ['an RSI level over 100', 'rsi', { levels: [{ value: 30 }, { value: 120 }] }],
    ['a third RSI level', 'rsi', { levels: [{ value: 30 }, { value: 50 }, { value: 70 }] }],
    ['a fill the indicator does not have', 'macd', { fills: { bands: { visible: true } } }],
    ['an unknown field in a line', 'adx', { lines: { adx: { style: 'dashed' } } }],
    ['a bad fill color', 'bollinger', { fills: { bands: { color: 'url(x)' } } }],
  ])('refuses %s', (_, key, value) => {
    expect(style(key, value)).toBeNull()
  })

  it('drops a stored indicator entry whose style carries enabled, keeping the others', () => {
    const prefs = parsePreferences({ indicatorSettings: { rsi: { style: { hidden: true } }, obv: { style: { lines: { obv: { color: '#2962ff' } } } } } })
    expect(prefs.indicatorSettings).toEqual({ obv: { style: { lines: { obv: { color: '#2962ff' } } } } })
  })
})
