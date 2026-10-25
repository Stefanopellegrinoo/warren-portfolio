// odd/tasks/chart-customization.md S2: the chart's settings open as a sheet from the bottom on a phone
// and as a dialog from 820px (the same component serves the indicator and alert settings later).
import { describe, it, expect, afterEach } from 'vitest'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { ChartSheet } from '../ChartSheet'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { document.body.innerHTML = '' })

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 50)) })
const sheet = () => document.querySelector<HTMLElement>('[role="dialog"]')

function Host({ footer }: { footer?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Abrir</button>
      <ChartSheet open={open} onOpenChange={setOpen} title="Canal paralelo" footer={footer}>
        <p>Opciones</p>
      </ChartSheet>
    </>
  )
}

async function render(footer?: React.ReactNode) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<Host footer={footer} />) })
  const opener = el.querySelector('button')!
  opener.focus()
  act(() => opener.click())
  await flush()
  return { opener, unmount: () => act(() => root.unmount()) }
}

describe('ChartSheet', () => {
  it('is a sheet from the bottom below 820px and a centered dialog from there', async () => {
    const { unmount } = await render()
    const classes = sheet()!.className.split(/\s+/)

    // Phone: full width at the bottom, rounded on top, at most 80% of the screen, clear of the home bar.
    expect(classes).toEqual(expect.arrayContaining([
      'max-[819px]:inset-x-0', 'max-[819px]:bottom-0', 'max-[819px]:rounded-t-xl', 'max-[819px]:max-h-[80dvh]', 'max-[819px]:pb-[env(safe-area-inset-bottom)]',
    ]))
    // Computer: centered.
    expect(classes).toEqual(expect.arrayContaining(['min-[820px]:left-1/2', 'min-[820px]:top-1/2', 'min-[820px]:-translate-x-1/2', 'min-[820px]:-translate-y-1/2']))
    unmount()
  })

  it('has its title and Listo on top, the options in a body that scrolls, and the footer last', async () => {
    const { unmount } = await render(<p>Pie</p>)
    const [header, body, footer] = [...sheet()!.children]

    expect(header.textContent).toBe('Canal paraleloListo')
    expect(body.textContent).toBe('Opciones')
    expect(body.className).toContain('overflow-y-auto')
    expect(footer.textContent).toBe('Pie')
    unmount()
  })

  it('Listo closes it and the focus goes back to what opened it', async () => {
    const { opener, unmount } = await render()

    act(() => [...sheet()!.querySelectorAll('button')].find((b) => b.textContent === 'Listo')!.click())
    await flush()

    expect(sheet()).toBeNull()
    expect(document.activeElement).toBe(opener)
    unmount()
  })

  it('keeps the focus inside while open, and Esc closes it', async () => {
    const { unmount } = await render()
    expect(sheet()!.contains(document.activeElement)).toBe(true)

    act(() => { sheet()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await flush()

    expect(sheet()).toBeNull()
    unmount()
  })
})
