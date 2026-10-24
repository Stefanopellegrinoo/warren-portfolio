// odd/tasks/ux-paginas.md S3: a destructive action asks inside the app, next to the button, instead of confirm().
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { InlineConfirm } from '../InlineConfirm'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { document.body.innerHTML = '' })

function mount(props: Partial<React.ComponentProps<typeof InlineConfirm>> = {}) {
  const onConfirm = vi.fn()
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  const render = (over: Partial<React.ComponentProps<typeof InlineConfirm>> = {}) => act(() => {
    root.render(<InlineConfirm question="¿Borrar el gasto?" confirmLabel="Sí, borrar" onConfirm={onConfirm} triggerLabel="Borrar Luz" {...props} {...over}>Borrar</InlineConfirm>)
  })
  render()
  const button = (text: string) => [...el.querySelectorAll('button')].find(b => b.textContent === text)
  const click = (text: string) => act(() => { button(text)!.click() })
  return { el, onConfirm, render, button, click }
}

describe('InlineConfirm', () => {
  it('shows only the action until it is tapped', () => {
    const { el, button } = mount()
    expect(button('Borrar')?.getAttribute('aria-label')).toBe('Borrar Luz')
    expect(el.textContent).not.toContain('¿Borrar el gasto?')
  })

  it('asks next to the action and confirms once', () => {
    const { el, onConfirm, click, button } = mount()
    click('Borrar')
    expect(el.textContent).toContain('¿Borrar el gasto?')
    expect(document.activeElement).toBe(button('Cancelar'))
    click('Sí, borrar')
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(el.textContent).not.toContain('¿Borrar el gasto?')
  })

  it('cancel and Escape close the question without confirming', () => {
    const { el, onConfirm, click } = mount()
    click('Borrar')
    click('Cancelar')
    expect(el.textContent).not.toContain('¿Borrar el gasto?')
    click('Borrar')
    act(() => { el.querySelector('[role="group"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(el.textContent).not.toContain('¿Borrar el gasto?')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  // Verifier A2: like a native confirm, cancelling returns the focus to the action.
  it('cancel and Escape give the focus back to the action', () => {
    const { el, click, button } = mount()
    click('Borrar')
    click('Cancelar')
    expect(document.activeElement).toBe(button('Borrar'))
    click('Borrar')
    act(() => { el.querySelector('[role="group"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.activeElement).toBe(button('Borrar'))
  })

  it('keeps the action disabled while the request is in flight', () => {
    const { render, button } = mount()
    render({ busy: true })
    expect(button('Borrar')?.disabled).toBe(true)
  })
})
