// odd/tasks/chart-pro-redesign.md S6: range chips 1M…Todo and %/log/auto under the chart, with the TradingView
// credit as a visible link; S7: on a phone the chips spread across the width and the link stays.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { ChartRangeBar, rangeChips, rangeFirstBar } from '../ChartRangeBar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { document.body.innerHTML = '' })

const at = (iso: string) => Date.parse(iso) / 1000

describe('rangeChips', () => {
  it('offers the ranges that make sense for each timeframe', () => {
    expect(rangeChips('15m')).toEqual(['1D', '5D', '1M'])
    expect(rangeChips('1h')).toEqual(['5D', '1M', '3M'])
    expect(rangeChips('1d')).toEqual(['1M', '3M', '6M', '1A', '5A', 'Todo'])
    expect(rangeChips('1w')).toEqual(['6M', '1A', '5A', 'Todo'])
    expect(rangeChips('1M')).toEqual(['1A', '5A', 'Todo'])
  })

  it("a crypto's other timeframes take the nearest one's", () => {
    expect(rangeChips('1m')).toEqual(rangeChips('15m'))
    expect(rangeChips('5m')).toEqual(rangeChips('15m'))
    expect(rangeChips('4h')).toEqual(rangeChips('1h'))
  })
})

describe('rangeFirstBar', () => {
  // A stock's 15-minute bars over three sessions, with a weekend in between.
  const sessions = ['2026-10-23', '2026-10-26', '2026-10-27'].flatMap((d) => ['T14:00:00Z', 'T15:00:00Z', 'T19:45:00Z'].map((h) => at(d + h)))

  it('1D and 5D count sessions with bars, not calendar days', () => {
    expect(rangeFirstBar('1D', sessions)).toBe(6)
    expect(rangeFirstBar('5D', sessions)).toBe(0)
    const days = Array.from({ length: 10 }, (_, i) => at('2026-10-01T15:00:00Z') + i * 86400)
    expect(rangeFirstBar('5D', days)).toBe(5)
  })

  it('months and years go back on the calendar from the last bar', () => {
    const daily = Array.from({ length: 800 }, (_, i) => at('2024-08-01T00:00:00Z') + i * 86400) // to 2026-10-09
    const first = (chip: Parameters<typeof rangeFirstBar>[0]) => new Date(daily[rangeFirstBar(chip, daily)] * 1000).toISOString().slice(0, 10)

    expect(first('1M')).toBe('2026-09-09')
    expect(first('6M')).toBe('2026-04-09')
    expect(first('1A')).toBe('2025-10-09')
    expect(first('5A')).toBe('2024-08-01') // more than the history: all of it
    expect(rangeFirstBar('Todo', daily)).toBe(0)
  })

  it('no bars: from the start', () => {
    expect(rangeFirstBar('1M', [])).toBe(0)
  })
})

describe('ChartRangeBar', () => {
  function render(props: Partial<Parameters<typeof ChartRangeBar>[0]> = {}) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    const onPick = vi.fn()
    const onScale = vi.fn()
    act(() => root.render(<ChartRangeBar chips={['1M', '3M', 'Todo']} active="3M" label="Período" onPick={onPick} scale="auto" onScale={onScale} percent {...props} />))
    const buttons = (group: string) => [...el.querySelectorAll(`[role="group"][aria-label="${group}"] button`)] as HTMLButtonElement[]
    return { el, onPick, onScale, buttons }
  }

  it('shows the chips, the one shown marked, and a chip picks its range', () => {
    const { onPick, buttons } = render()

    expect(buttons('Período').map((b) => b.textContent)).toEqual(['1M', '3M', 'Todo'])
    expect(buttons('Período').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
    act(() => buttons('Período')[2].click())
    expect(onPick).toHaveBeenCalledWith('Todo')
  })

  it('switches the price scale between %, log and auto, the one in use marked', () => {
    const { onScale, buttons } = render({ scale: 'log' })

    expect(buttons('Escala').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['%', 'false'], ['log', 'true'], ['auto', 'false']])
    act(() => buttons('Escala')[0].click())
    expect(onScale).toHaveBeenCalledWith('pct')
  })

  it('without % when the scale already reads in % (comparing)', () => {
    const { buttons } = render({ percent: false })

    expect(buttons('Escala').map((b) => b.textContent)).toEqual(['log', 'auto'])
  })

  it('credits TradingView with a link that a phone shows too, and keeps the scale buttons off the phone', () => {
    const { el } = render()

    const link = el.querySelector('a')!
    expect(link.textContent).toBe('Gráficos de TradingView')
    expect(link.getAttribute('href')).toBe('https://www.tradingview.com/')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.className).not.toMatch(/hidden/)
    expect(el.querySelector('[aria-label="Escala"]')!.className).toContain('max-[819px]:hidden')
    expect(el.querySelector('[aria-label="Período"]')!.className).toContain('max-[819px]:justify-between')
  })

  it('a note goes next to the chips (the day a comparison starts)', () => {
    const { el } = render({ note: 'desde 31/12/25' })

    expect(el.textContent).toContain('desde 31/12/25')
  })
})
