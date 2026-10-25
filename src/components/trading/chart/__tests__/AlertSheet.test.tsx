// odd/tasks/chart-customization.md S6: the alert sheet — Cuando, Cruce, Contra, the timeframe note, Color, the
// sentence that restates the condition, Guardar and Borrar alerta.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { DEFAULT_CONFIG } from '@/lib/store/chart-store'
import type { ChartAlert } from '@/lib/chart/alerts'
import type { Timeframe } from '@/lib/binance/types'
import { AlertSheet } from '../AlertSheet'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { document.body.innerHTML = '' })

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
const sheet = () => document.querySelector<HTMLElement>('[role="dialog"]')!
const byLabel = <T extends HTMLElement>(label: string) => sheet().querySelector<T>(`[aria-label="${label}"]`)!
const button = (text: string) => [...sheet().querySelectorAll('button')].find((b) => b.textContent === text)!
const radio = (text: string) => [...sheet().querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === text)!
const sentence = () => sheet().querySelector('[data-alert-sentence]')!.textContent
const note = () => sheet().querySelector('[data-alert-note]')?.textContent ?? null

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

// The last value of each line on the chart: FXI at 32,5, its EMA 50 at 31,2, its RSI at 55,37.
const LAST: Record<string, number> = { price: 32.5, 'ema50.ema50': 31.2, 'rsi.rsi': 55.37 }

async function open({ alert, timeframe = '1d', config = DEFAULT_CONFIG }: { alert?: ChartAlert; timeframe?: Timeframe; config?: typeof DEFAULT_CONFIG } = {}) {
  const onSave = vi.fn(async () => true)
  const onDelete = vi.fn()
  const onRearm = vi.fn()
  const onOpenChange = vi.fn()
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => {
    root.render(
      <AlertSheet open onOpenChange={onOpenChange} ticker="FXI" alert={alert} timeframe={timeframe} config={config} lastValue={(l) => LAST[l] ?? null} onSave={onSave} onDelete={onDelete} onRearm={onRearm} />,
    )
  })
  await flush()
  return { onSave, onDelete, onRearm, onOpenChange, unmount: () => act(() => root.unmount()) }
}

const EXISTING: ChartAlert = {
  id: 'a1', ticker: 'FXI', name: 'FXI cruza por encima de 31,00', status: 'active', color: null,
  source: 'price', operator: 'crosses_above', target: 'value', value: 31, timeframe: null, periods: null,
}

describe('a new alert', () => {
  it('starts from the last price, either way, and says so in a sentence', async () => {
    const { onSave, unmount } = await open()

    expect(sheet().textContent).toContain('Nueva alerta · FXI')
    expect(byLabel<HTMLSelectElement>('Cuando').value).toBe('price')
    expect(radio('Cualquiera').getAttribute('aria-checked')).toBe('true')
    expect(byLabel<HTMLInputElement>('Valor').value).toBe('32,5')
    expect(sentence()).toBe('Te avisa una vez cuando el precio de FXI cruce 32,50, para arriba o para abajo.')
    expect(note()).toBeNull()
    expect(button('Borrar alerta')).toBeUndefined()

    act(() => button('Guardar').click())
    await flush()

    expect(onSave).toHaveBeenCalledWith({ source: 'price', operator: 'crosses', target: 'value', value: 32.5, timeframe: null, periods: null, color: null })
    unmount()
  })

  it('"price crosses EMA 50": another line, the chart\'s timeframe and the period the chart uses', async () => {
    const { onSave, unmount } = await open({ timeframe: '1d' })

    act(() => radio('Otra línea').click())
    setValue(byLabel<HTMLSelectElement>('Línea'), 'ema50.ema50')

    expect(byLabel('Valor')).toBeNull()
    expect(sentence()).toBe('Te avisa una vez cuando el precio de FXI cruce la EMA 50, para arriba o para abajo.')
    expect(note()).toBe('Con velas de 1D, el intervalo del gráfico.')

    act(() => button('Guardar').click())
    await flush()

    expect(onSave).toHaveBeenCalledWith({ source: 'price', operator: 'crosses', target: 'ema50.ema50', value: null, timeframe: '1d', periods: { ema50: 50 }, color: null })
    unmount()
  })

  it('"RSI crosses 70 up": the line\'s last value to start from, the chart\'s RSI period and timeframe', async () => {
    const { onSave, unmount } = await open({ timeframe: '1h', config: { ...DEFAULT_CONFIG, rsi: 21 } })

    setValue(byLabel<HTMLSelectElement>('Cuando'), 'rsi.rsi')
    expect(byLabel<HTMLInputElement>('Valor').value).toBe('55,37')
    setValue(byLabel<HTMLInputElement>('Valor'), '70')
    act(() => radio('Cruza para arriba').click())

    expect(sentence()).toBe('Te avisa una vez cuando el RSI 21 de FXI cruce 70, para arriba.')
    expect(note()).toBe('Con velas de 1h, el intervalo del gráfico.')

    act(() => button('Guardar').click())
    await flush()

    expect(onSave).toHaveBeenCalledWith({ source: 'rsi.rsi', operator: 'crosses_above', target: 'value', value: 70, timeframe: '1h', periods: { rsi: 21 }, color: null })
    unmount()
  })

  it('lists the price and every indicator line to watch, with the periods the chart uses', async () => {
    const { unmount } = await open()

    const options = [...byLabel<HTMLSelectElement>('Cuando').options].map((o) => o.textContent)
    expect(options).toEqual([
      'Precio', 'EMA 20', 'EMA 50', 'EMA 200', 'RSI 14', 'MACD 12 26 9', 'MACD 12 26 9 señal',
      'BB 20 2 superior', 'BB 20 2 media', 'BB 20 2 inferior', 'OBV', 'Estocástico 14 3 3 %K', 'Estocástico 14 3 3 %D',
      'ADX 14', 'ADX 14 +DI', 'ADX 14 -DI',
    ])
    unmount()
  })

  it('cannot be saved without a value', async () => {
    const { onSave, unmount } = await open()

    setValue(byLabel<HTMLInputElement>('Valor'), '')

    expect(button('Guardar').disabled).toBe(true)
    act(() => button('Guardar').click())
    expect(onSave).not.toHaveBeenCalled()
    unmount()
  })
})

describe('an existing alert', () => {
  it('takes a price typed by hand and a color', async () => {
    const { onSave, unmount } = await open({ alert: EXISTING })
    expect(sheet().textContent).toContain('Alerta · FXI')
    expect(byLabel<HTMLInputElement>('Valor').value).toBe('31')
    expect(radio('Cruza para arriba').getAttribute('aria-checked')).toBe('true')

    setValue(byLabel<HTMLInputElement>('Valor'), '33,1')
    act(() => byLabel<HTMLButtonElement>('Color de la alerta rojo').click())
    await flush()
    expect(sentence()).toBe('Te avisa una vez cuando el precio de FXI cruce 33,10, para arriba.')

    act(() => button('Guardar').click())
    await flush()

    expect(onSave).toHaveBeenCalledWith({ source: 'price', operator: 'crosses_above', target: 'value', value: 33.1, timeframe: null, periods: null, color: '#f23645' })
    unmount()
  })

  it('an indicator alert keeps the timeframe and periods of its creation, whatever the chart shows now', async () => {
    const rsi: ChartAlert = { ...EXISTING, source: 'rsi.rsi', value: 70, timeframe: '1h', periods: { rsi: 14 } }
    const { onSave, unmount } = await open({ alert: rsi, timeframe: '1d', config: { ...DEFAULT_CONFIG, rsi: 21 } })

    expect(note()).toBe('Con velas de 1h, el intervalo del gráfico cuando la creaste.')
    act(() => radio('Cualquiera').click())
    act(() => button('Guardar').click())
    await flush()

    expect(onSave).toHaveBeenCalledWith({ source: 'rsi.rsi', operator: 'crosses', target: 'value', value: 70, timeframe: '1h', periods: { rsi: 14 }, color: null })
    unmount()
  })

  it('Borrar alerta deletes it', async () => {
    const { onDelete, unmount } = await open({ alert: EXISTING })

    act(() => button('Borrar alerta').click())

    expect(onDelete).toHaveBeenCalledOnce()
    unmount()
  })

  it('one the server cannot check says "No se puede revisar" and can be reactivated', async () => {
    const { onRearm, unmount } = await open({ alert: { ...EXISTING, status: 'unavailable' } })

    expect(sheet().textContent).toContain('No se puede revisar')
    act(() => button('Reactivar').click())

    expect(onRearm).toHaveBeenCalledOnce()
    unmount()
  })
})

describe('closing', () => {
  const esc = () => act(() => { sheet().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })

  it('saves from the header, where the other sheets say Listo: no button there drops the edit', async () => {
    const { onSave, unmount } = await open({ alert: EXISTING })
    setValue(byLabel<HTMLInputElement>('Valor'), '33,75')
    await flush()

    expect(button('Listo')).toBeUndefined()
    expect([...sheet().querySelectorAll('button')].filter((b) => b.textContent === 'Guardar')).toHaveLength(1)
    act(() => button('Guardar').click())
    await flush()
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ value: 33.75 }))
    unmount()
  })

  it('Esc on an edited alert saves the change instead of dropping it', async () => {
    const { onSave, unmount } = await open({ alert: EXISTING })
    setValue(byLabel<HTMLInputElement>('Valor'), '33,75')
    await flush()

    esc()
    await flush()
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ value: 33.75 }))
    unmount()
  })

  it('Esc on an alert left as it was saves nothing and closes', async () => {
    const { onSave, onOpenChange, unmount } = await open({ alert: EXISTING })

    esc()
    await flush()
    expect(onSave).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything())
    unmount()
  })

  it('Esc on a new alert creates nothing', async () => {
    const { onSave, onOpenChange, unmount } = await open()

    esc()
    await flush()
    expect(onSave).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything())
    unmount()
  })
})
