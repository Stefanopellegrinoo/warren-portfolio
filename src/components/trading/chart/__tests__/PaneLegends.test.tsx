// odd/tasks/chart-pro-redesign.md S1: every pane carries its own legend (name, values that follow the crosshair,
// minimize, hide, settings, remove); S7: on a phone the price legend stays short at rest.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { IndicatorKey } from '@/lib/store/chart-store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Node 25 ships a stub localStorage without methods; the persisted chart store needs a real one.
vi.hoisted(() => {
  const data = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) },
  })
})

const { PaneLegends } = await import('../PaneLegends')
const { useChartStore, DEFAULT_CONFIG } = await import('@/lib/store/chart-store')
const { INDICATOR_SPECS } = await import('@/lib/chart/indicator-specs')

const initial = useChartStore.getState()
afterEach(() => { useChartStore.setState(initial, true); document.body.innerHTML = '' })

const candles = Array.from({ length: 60 }, (_, i) => ({ time: 1000 + i, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 1_234_567 + i }))
const KEYS: IndicatorKey[] = ['ema20', 'volume', 'rsi', 'macd', 'stochastic', 'adx', 'obv']
const linesOf = (keys: IndicatorKey[]) => new Map(keys.map((k) => [k, INDICATOR_SPECS[k].lines(candles, DEFAULT_CONFIG)]))

function render({ keys = KEYS, at = null as number | null, tops = [0, 300, 400, 500, 600, 700], saved = {} } = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  const draw = (a: number | null) => act(() => root.render(
    <PaneLegends keys={keys} lines={linesOf(keys)} config={DEFAULT_CONFIG} saved={saved} at={a} tops={tops} head={<p>OHLC</p>}>
      <p>+ Comparar</p>
    </PaneLegends>,
  ))
  draw(at)
  return { el, draw }
}
const price = () => document.querySelector<HTMLElement>('[data-chart-legend]')!
const pane = (k: string) => document.querySelector<HTMLElement>(`[data-pane-legend="${k}"]`)!
const byLabel = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!

describe('PaneLegends: the price pane', () => {
  it('names each indicator over the price with its last value, between the candle data and Comparar', () => {
    render()

    const text = price().textContent!
    expect(text.startsWith('OHLC')).toBe(true)
    expect(text.endsWith('+ Comparar')).toBe(true)
    const ema = INDICATOR_SPECS.ema20.lines(candles, DEFAULT_CONFIG)[0].data.at(-1)!.value
    expect(text).toContain(`EMA 20${ema.toFixed(2).replace('.', ',')}`)
    expect(text).toContain('Volumen1,2 M')
    expect(text).not.toContain('RSI')
  })

  it('hide, settings and remove, with Spanish names; no minimize over the price', () => {
    render()

    expect(byLabel('Ocultar EMA 20')).toBeTruthy()
    expect(byLabel('Ajustes EMA 20')).toBeTruthy()
    expect(byLabel('Quitar EMA 20')).toBeTruthy()
    expect(byLabel('Minimizar EMA 20')).toBeNull()
    expect(price().querySelector('button[aria-label^="Minimizar"]')).toBeNull()
  })

  it('on a phone, the values over the price wait for a finger on the chart', () => {
    const { draw } = render()
    const values = () => price().querySelector('[data-values="ema20"]')!

    expect(values().className).toContain('max-[819px]:hidden')
    draw(1050)
    expect(values().className).not.toContain('max-[819px]:hidden')
  })
})

describe('PaneLegends: indicator panes', () => {
  it('each pane has its legend at its top, in the order of the panes', () => {
    render()

    expect(['rsi', 'macd', 'stochastic', 'adx', 'obv'].map((k) => pane(k).style.top)).toEqual(['304px', '404px', '504px', '604px', '704px'])
    expect(pane('rsi').textContent).toContain('RSI 14')
  })

  it('a pane not measured yet keeps its legend out of sight', () => {
    render({ tops: [0] })

    expect(pane('rsi').className).toContain('invisible')
  })

  it("names every value: MACD's three, the stochastic's %K and %D, ADX's ADX, +DI and −DI, OBV compact", () => {
    render()

    expect(pane('macd').querySelectorAll('[data-values] > span')).toHaveLength(3)
    expect(pane('stochastic').textContent).toMatch(/%K\s?[\d,]+%D\s?[\d,]+/)
    expect(pane('adx').textContent).toMatch(/ADX\s?[\d,]+\+DI\s?[\d,]+−DI\s?[\d,]+/)
    expect(pane('obv').textContent).toMatch(/OBV[\d,]+ M/)
    expect(pane('rsi').textContent).toMatch(/RSI 14[\d]+,\d$/)
  })

  it("an indicator's values share one precision: MACD's histogram near zero reads like its line", () => {
    render()

    const texts = [...pane('macd').querySelectorAll('[data-values] > span')].map((v) => v.textContent)
    texts.forEach((t) => expect(t).toMatch(/^−?[\d.]+,\d{2}$/))
  })

  it('the values follow the crosshair, and a bar before an indicator has data reads —', () => {
    const { draw } = render({ at: 1005 })
    expect(pane('rsi').textContent).toContain('—')

    draw(1059)
    const last = INDICATOR_SPECS.rsi.lines(candles, DEFAULT_CONFIG)[0].data.at(-1)!.value
    expect(pane('rsi').textContent).toContain(last.toFixed(1).replace('.', ','))
  })

  it('minimize, hide, settings and remove act on the store', () => {
    render()

    act(() => byLabel('Ocultar RSI 14').click())
    expect(useChartStore.getState().hidden.rsi).toBe(true)
    expect(byLabel('Mostrar RSI 14')).toBeTruthy()

    act(() => byLabel('Ajustes MACD 12 26 9').click())
    expect(useChartStore.getState().settingsTarget).toBe('macd')

    act(() => byLabel('Quitar OBV').click())
    expect(useChartStore.getState().indicators.obv).toBe(false)

    act(() => byLabel('Minimizar ADX 14').click())
    expect(useChartStore.getState().minimized.adx).toBe(true)
  })

  it('a minimized pane reads "<name> · minimizado" without values; its name or Expandir opens it', () => {
    useChartStore.setState({ minimized: { ...initial.minimized, adx: true, rsi: true } })
    render()

    expect(pane('adx').textContent).toContain('ADX 14 · minimizado')
    expect(pane('adx').querySelector('[data-values]')).toBeNull()
    act(() => byLabel('Expandir ADX 14').click())
    expect(useChartStore.getState().minimized.adx).toBe(false)

    act(() => pane('rsi').querySelector<HTMLButtonElement>('button')!.click())
    expect(useChartStore.getState().minimized.rsi).toBe(false)
  })

  it("the actions show on hover or focus, and a tap on the name shows them (a phone has no hover)", () => {
    render()
    const actions = () => pane('rsi').querySelector('[data-actions]')!

    expect(actions().className).toMatch(/hidden.*group-hover:inline-flex.*group-focus-within:inline-flex/)
    act(() => pane('rsi').querySelector<HTMLButtonElement>('button')!.click())
    expect(actions().className).not.toMatch(/(^| )hidden/)
    expect(pane('rsi').querySelector('button')!.getAttribute('aria-expanded')).toBe('true')
  })

  it('a hidden indicator stays listed, dimmed, so it can be shown again', () => {
    useChartStore.setState({ hidden: { ...initial.hidden, macd: true } })
    render()

    expect(pane('macd').querySelector('[data-row]')!.className).toContain('opacity-50')
    expect(byLabel('Mostrar MACD 12 26 9')).toBeTruthy()
  })
})
