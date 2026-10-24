import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { DrawingManager } from 'lightweight-charts-drawing'
import { DrawingTools } from '../DrawingTools'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

const QUESTION = '¿Borrar todos los dibujos de este activo?'
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text))
const trash = () => document.querySelector<HTMLButtonElement>('button[aria-label="Borrar todos los dibujos"]')!

async function render(drawings: number) {
  const manager = {
    on: vi.fn(() => () => {}),
    drawings: vi.fn(() => Array.from({ length: drawings }, (_, i) => ({ id: String(i) }))),
    clear: vi.fn(),
    setTool: vi.fn(),
    setMagnet: vi.fn(),
    setDrawingsVisible: vi.fn(),
  }
  const confirm = vi.spyOn(window, 'confirm')
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<DrawingTools manager={manager as unknown as DrawingManager} alertMode={false} onAlertMode={() => {}} />) })
  return { manager, confirm, unmount: () => act(() => root.unmount()) }
}

describe('DrawingTools — "Borrar todos los dibujos" asks inside the app', () => {
  it('asks with the same question and clears only on "Sí, borrar"', async () => {
    const { manager, confirm, unmount } = await render(2)

    act(() => trash().click())
    await flush()

    expect(document.body.textContent).toContain(QUESTION)
    expect(confirm).not.toHaveBeenCalled()
    expect(manager.clear).not.toHaveBeenCalled()

    act(() => button('Sí, borrar')!.click())
    await flush()

    expect(manager.clear).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain(QUESTION)
    unmount()
  })

  it('Cancelar keeps the drawings', async () => {
    const { manager, unmount } = await render(2)

    act(() => trash().click())
    await flush()
    act(() => button('Cancelar')!.click())
    await flush()

    expect(manager.clear).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain(QUESTION)
    unmount()
  })

  it('with no drawings it does not ask', async () => {
    const { manager, confirm, unmount } = await render(0)

    act(() => trash().click())
    await flush()

    expect(document.body.textContent).not.toContain(QUESTION)
    expect(confirm).not.toHaveBeenCalled()
    expect(manager.clear).not.toHaveBeenCalled()
    unmount()
  })
})
