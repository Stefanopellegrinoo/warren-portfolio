// odd/tasks/ux-paginas.md S3, verifier B1: the open popover stacks above the chart canvas. Base UI positions
// the Positioner with a transform, so the Popup's own z-index cannot leave it: the Positioner carries it.
import { describe, it, expect, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { Popover, PopoverContent, PopoverTrigger } from '../popover'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { document.body.innerHTML = '' })

describe('PopoverContent', () => {
  it('puts the z-index on the positioner, the layer that stacks against the page', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<Popover open><PopoverTrigger>Abrir</PopoverTrigger><PopoverContent>Hola</PopoverContent></Popover>) })
    const positioner = document.querySelector('[data-slot="popover-positioner"]')
    expect(positioner?.className).toContain('z-50')
    expect(positioner?.textContent).toBe('Hola')
    act(() => root.unmount())
  })
})
