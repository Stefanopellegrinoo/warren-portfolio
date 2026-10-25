// odd/tasks/chart-customization.md S4: the menu names an indicator by the values the chart uses (the account's
// over this device's), and turning one on or off stays on this device (S8: as before).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Node 25 ships a stub localStorage without methods; the persisted chart store needs a real one.
vi.hoisted(() => {
  const data = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) },
  })
})
vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))

const { IndicatorMenu } = await import('../IndicatorMenu')
const { useChartStore, DEFAULT_CONFIG } = await import('@/lib/store/chart-store')
const { getPreferences, setIndicatorSettings } = await import('@/lib/chart/preferences')

const initial = useChartStore.getState()
afterEach(() => {
  setIndicatorSettings('rsi', null)
  useChartStore.setState(initial, true)
  document.body.innerHTML = ''
})

async function openMenu() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<IndicatorMenu />) })
  const trigger = el.querySelector<HTMLButtonElement>('[aria-label="Indicadores"]')!
  await act(async () => {
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    trigger.click()
    await new Promise((r) => setTimeout(r, 50))
  })
  return { unmount: () => act(() => root.unmount()) }
}
const item = (text: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => i.textContent?.startsWith(text))

describe('IndicatorMenu', () => {
  it("names RSI by the period saved in the account, over this device's", async () => {
    useChartStore.setState({ config: { ...DEFAULT_CONFIG, rsi: 9, ema20: 30 } })
    setIndicatorSettings('rsi', { values: { rsi: 21 } })
    const { unmount } = await openMenu()

    expect(item('RSI')!.textContent).toBe('RSI (21)')
    expect(item('EMA 30')).toBeDefined()
    unmount()
  })

  it('a click still turns an indicator on or off on this device, and nothing reaches the account', async () => {
    const { unmount } = await openMenu()
    expect(useChartStore.getState().indicators.obv).toBe(false)

    await act(async () => { item('OBV')!.click() })

    expect(useChartStore.getState().indicators.obv).toBe(true)
    expect(getPreferences().indicatorSettings).toEqual({})
    unmount()
  })
})
