// odd/tasks/chart-customization.md S5: an indicator's settings sheet, Valores and Estilo. S4: what the user
// saves there goes to the account for that indicator only; which indicators are on or hidden never does.
// S8: the periods keep today's limits.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
  init?.method === 'PATCH'
    ? new Response(null, { status: 204 })
    : new Response(JSON.stringify({ userId: 'u1', preferences: { favorites: {}, toolStyles: {}, indicatorSettings: {} } })))
vi.stubGlobal('fetch', fetchMock)

const { IndicatorSettingsDialog } = await import('../IndicatorSettingsDialog')
const { useChartStore, DEFAULT_CONFIG } = await import('@/lib/store/chart-store')
const { getPreferences, setIndicatorSettings, subscribe, SAVE_DELAY_MS } = await import('@/lib/chart/preferences')

const initial = useChartStore.getState()
const sleep = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const sheet = () => document.querySelector<HTMLElement>('[role="dialog"]')
const group = (name: string) => sheet()!.querySelector<HTMLElement>(`[role="group"][aria-label="${name}"]`)
const groups = () => [...sheet()!.querySelectorAll<HTMLElement>('[role="group"]')].map((g) => g.getAttribute('aria-label'))
const byLabel = <T extends HTMLElement = HTMLButtonElement>(label: string, within: ParentNode = sheet()!) => within.querySelector<T>(`[aria-label="${label}"]`)!
const byText = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === text)!
const saved = (key: IndicatorKey) => getPreferences().indicatorSettings[key]
const patches = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([, init]) => JSON.parse(String(init!.body)))

/** Types into a number field the way React sees it. */
function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    input.focus()
    set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const field = (label: string) => [...sheet()!.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))!.querySelector('input')!

let unmount: () => void
async function open(key: IndicatorKey) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<IndicatorSettingsDialog />) })
  act(() => useChartStore.getState().setSettingsTarget(key))
  await sleep(50)
  unmount = () => act(() => root.unmount())
}
async function close() {
  act(() => byText('Listo').click())
  await sleep(50)
}

beforeEach(async () => {
  // The account answered (once per tab), so saves go out.
  subscribe(() => {})
  await sleep(0)
})
afterEach(() => {
  unmount?.()
  Object.keys(getPreferences().indicatorSettings).forEach((k) => setIndicatorSettings(k as IndicatorKey, null))
  useChartStore.setState(initial, true)
  document.body.innerHTML = ''
})

describe('the indicator settings sheet', () => {
  it.each<[IndicatorKey, string[]]>([
    ['ema50', ['Línea']],
    ['bollinger', ['Banda superior', 'Media', 'Banda inferior', 'Fondo entre bandas']],
    ['rsi', ['RSI', 'Nivel superior', 'Nivel inferior', 'Fondo entre niveles']],
    ['macd', ['MACD', 'Señal', 'Histograma']],
    ['volume', ['Barras']],
    ['stochastic', ['%K', '%D']],
    ['adx', ['ADX', '+DI', '−DI']],
    ['obv', ['OBV']],
  ])('%s shows Valores and Estilo with each of its lines', async (key, parts) => {
    await open(key)

    expect([...sheet()!.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['Valores', 'Estilo'])
    expect(groups()).toEqual(parts)
    expect(byText('Volver al de fábrica')).toBeDefined()
    unmount()
  })

  it('volume and the MACD histogram offer a color for rising bars and one for falling', async () => {
    await open('volume')
    expect(byLabel('Color cuando sube verde', group('Barras')!)).not.toBeNull()
    expect(byLabel('Color cuando baja rojo', group('Barras')!)).not.toBeNull()
    unmount()
  })
})

describe('Estilo', () => {
  it("a line's color, width and visibility apply at once and are saved as that indicator's settings", async () => {
    await open('ema50')
    const line = group('Línea')!

    act(() => byLabel('Color rojo', line).click())
    act(() => byLabel('Grosor 3', line).click())
    act(() => line.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())

    expect(saved('ema50')).toEqual({ values: { ema50: 50 }, style: { lines: { ema50: { color: '#f23645', width: 3, visible: false } } } })
    expect(byLabel('Grosor 3', line).getAttribute('aria-pressed')).toBe('true')
    unmount()
  })

  it("RSI's upper level moves to 80 and takes its color; the fill between the levels turns on", async () => {
    await open('rsi')
    const upper = group('Nivel superior')!

    type(upper.querySelector('input[type="number"]')!, '80')
    act(() => { upper.querySelector('input[type="number"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    act(() => byLabel('Color rojo', upper).click())
    act(() => [...group('Fondo entre niveles')!.querySelectorAll('label')].find((l) => l.textContent === 'Fondo visible')!.querySelector('input')!.click())

    expect(saved('rsi')!.style).toEqual({ levels: [{ value: 30 }, { value: 80, color: '#f23645' }], fills: { levels: { visible: true } } })
    unmount()
  })

  it('the MACD histogram saves its rising and falling colors', async () => {
    await open('macd')
    const bars = group('Histograma')!

    act(() => byLabel('Color cuando sube verde', bars).click())
    act(() => byLabel('Color cuando baja rojo', bars).click())

    expect(saved('macd')!.style).toEqual({ lines: { histogram: { upColor: '#089981', downColor: '#f23645' } } })
    unmount()
  })

  it('the Bollinger fill turns on and off with its color and transparency', async () => {
    await open('bollinger')
    const fill = group('Fondo entre bandas')!
    const toggle = () => [...fill.querySelectorAll('label')].find((l) => l.textContent === 'Fondo visible')!.querySelector('input')!

    expect(toggle().checked).toBe(false)
    act(() => toggle().click())
    act(() => byLabel('Color de fondo violeta', fill).click())
    expect(saved('bollinger')!.style!.fills).toEqual({ bands: { visible: true, color: '#9c27b0' } })
    act(() => toggle().click())
    expect(saved('bollinger')!.style!.fills!.bands!.visible).toBe(false)
    unmount()
  })
})

describe('Valores', () => {
  it.each<[IndicatorKey, string, string, Record<string, number>]>([
    ['ema20', 'Período', '1', { ema20: 2 }],
    ['ema200', 'Período', '900', { ema200: 500 }],
    ['rsi', 'Período', '500', { rsi: 100 }],
    ['macd', 'Lenta', '300', { macdFast: 12, macdSlow: 200, macdSignal: 9 }],
    ['bollinger', 'Desv. estándar', '9', { bbPeriod: 20, bbStdDev: 5 }],
    ['stochastic', 'Suavizado', '50', { stochK: 14, stochSmooth: 20, stochD: 3 }],
    ['adx', 'Período', '1', { adxPeriod: 2 }],
  ])('%s: %s %s is kept within today\'s limits and saved when the sheet closes', async (key, label, typed, values) => {
    await open(key)

    type(field(label), typed)
    await close()

    expect(sheet()).toBeNull()
    expect(saved(key)!.values).toEqual(values)
    expect(useChartStore.getState().config).toEqual(DEFAULT_CONFIG)
    unmount()
  })

  it('closing with Esc keeps what was typed too', async () => {
    await open('rsi')
    type(field('Período'), '21')

    act(() => { field('Período').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await sleep(50)

    expect(sheet()).toBeNull()
    expect(saved('rsi')!.values).toEqual({ rsi: 21 })
    unmount()
  })

  it("the stochastic's long-term preset still fills 21, 5, 5", async () => {
    await open('stochastic')
    act(() => byText('Largo plazo (21, 5, 5)').click())
    expect(saved('stochastic')!.values).toEqual({ stochK: 21, stochSmooth: 5, stochD: 5 })
    unmount()
  })

  it('shows the values the chart uses: the saved ones over this device\'s', async () => {
    useChartStore.setState({ config: { ...DEFAULT_CONFIG, rsi: 9 } })
    setIndicatorSettings('rsi', { values: { rsi: 21 } })
    await open('rsi')
    expect(field('Período').value).toBe('21')
    unmount()
  })
})

describe('saving to the account (S4)', () => {
  it('opening and closing without a change saves nothing', async () => {
    await open('macd')
    await close()
    expect(saved('macd')).toBeUndefined()
    unmount()
  })

  it("sends only that indicator's settings, never which indicators are on or hidden", async () => {
    await sleep(SAVE_DELAY_MS + 100) // whatever an earlier test left goes out first
    fetchMock.mockClear()
    act(() => { useChartStore.getState().toggleIndicator('obv'); useChartStore.getState().toggleHidden('rsi') })
    await open('rsi')

    act(() => byLabel('Color rojo', group('RSI')!).click())
    await close()
    await sleep(SAVE_DELAY_MS + 100)

    expect(patches()).toEqual([{ indicatorSettings: { rsi: { values: { rsi: 14 }, style: { lines: { rsi: { color: '#f23645' } } } } } }])
    expect(JSON.stringify(getPreferences())).not.toMatch(/enabled|hidden/)
    unmount()
  })

  it('Volver al de fábrica forgets the saved settings and brings the factory values back on this device', async () => {
    useChartStore.setState({ config: { ...DEFAULT_CONFIG, rsi: 9, ema20: 30 } })
    setIndicatorSettings('rsi', { values: { rsi: 21 }, style: { lines: { rsi: { color: '#f23645' } } } })
    await open('rsi')

    act(() => byText('Volver al de fábrica').click())

    expect(saved('rsi')).toBeUndefined()
    expect(useChartStore.getState().config).toEqual({ ...DEFAULT_CONFIG, ema20: 30 })
    expect(field('Período').value).toBe('14')
    unmount()
  })
})

// odd/tasks/chart-customization.md S8 (L9): the sheet's switches and width row are the drawing settings' own,
// not copies of them: same markup, same look.
const { Toggle, Widths } = await import('../DrawingSettings')
describe("the drawing settings' controls", () => {
  const markup = async (node: React.ReactNode) => {
    const el = document.createElement('div')
    const root = createRoot(el)
    await act(async () => { root.render(node) })
    const html = el.innerHTML
    act(() => root.unmount())
    return html
  }

  it("a line's switch and widths are the drawing settings' Toggle and Widths", async () => {
    await open('ema50')
    const line = group('Línea')!

    expect(line.querySelector('label')!.outerHTML).toBe(await markup(<Toggle label="Línea" checked onChange={() => {}} />))
    expect(byLabel('Grosor 1', line).parentElement!.outerHTML).toBe(await markup(<Widths value={1} onPick={() => {}} />))
    unmount()
  })
})

// odd/tasks/chart-customization.md S8 (L9): most factory indicator colors are not among the 8 swatches, so no
// swatch showed as chosen until one was picked. The line's color now shows first, chosen.
describe('the current color', () => {
  const css = (color: string) => { const s = document.createElement('span'); s.style.background = color; return s.style.background }
  const chosen = (within: HTMLElement) => [...within.querySelectorAll('[aria-label]')].filter((s) => s.querySelector('svg')).map((s) => s.getAttribute('aria-label'))

  it("a factory color not in the palette shows first, chosen; a palette color is picked and saved as before", async () => {
    await open('rsi')
    const line = group('RSI')!

    expect(chosen(line)).toEqual(['Color actual'])
    expect(byLabel<HTMLElement>('Color actual', line).querySelector('span')!.style.background).toBe(css('#7E57C2'))
    act(() => byLabel('Color rojo', line).click())

    expect(saved('rsi')).toEqual({ values: { rsi: 14 }, style: { lines: { rsi: { color: '#f23645' } } } })
    expect(chosen(line)).toEqual(['Color rojo'])
    expect(byLabel('Color actual', line)).toBeNull()
    unmount()
  })

  it('a factory color in the palette in capitals is that swatch (Bollinger is azul, EMA 20 celeste)', async () => {
    await open('bollinger')
    expect(chosen(group('Banda superior')!)).toEqual(['Color azul'])
    expect(chosen(group('Media')!)).toEqual(['Color actual'])
    unmount()
    await open('ema20')
    expect(chosen(group('Línea')!)).toEqual(['Color celeste'])
    unmount()
  })

  it("the histogram's rising and falling colors and a fill's color show theirs too", async () => {
    await open('macd')
    expect(chosen(group('Histograma')!)).toEqual(['Color cuando sube actual', 'Color cuando baja actual'])
    unmount()
    await open('rsi')
    expect(chosen(group('Fondo entre niveles')!)).toEqual(['Color de fondo actual'])
    unmount()
  })

  it("a level shows the chart's level color", async () => {
    document.documentElement.style.setProperty('--ink-3', '#8a8478')
    await open('rsi')
    expect(chosen(group('Nivel superior')!)).toEqual(['Color actual'])
    unmount()
    document.documentElement.style.removeProperty('--ink-3')
  })
})
