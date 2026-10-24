import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { renderToStaticMarkup } from 'react-dom/server'
import { toast } from 'sonner'
import ImportModal from '../ImportModal'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), info: vi.fn() } }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
})
afterEach(() => { vi.unstubAllGlobals(); vi.mocked(toast.error).mockClear(); document.body.innerHTML = '' })

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find(b => b.textContent?.includes(text))
const REPLACE_WARNING = 'Se van a borrar todas tus operaciones y reemplazar por las del archivo'

function stubFetch(status: () => Response, post = () => new Response(JSON.stringify({ jobId: '7' }), { status: 202 })) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url)
    if (url.startsWith('/api/transactions/import/status')) return status()
    if (url.startsWith('/api/transactions/import')) return post()
    throw new Error(`unexpected fetch ${url}`)
  }))
  return calls
}

async function open() {
  const onClose = vi.fn()
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<ImportModal onClose={onClose} onSuccess={() => {}} />) })
  const chooseFile = () => {
    const input = el.querySelector<HTMLInputElement>('#import-file')!
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'ops.xlsx')], configurable: true })
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  return { el, onClose, chooseFile, unmount: () => act(() => root.unmount()) }
}

describe('ImportModal — "Reemplazar todo" asks a second time', () => {
  it('names the consequence and imports only after the explicit confirmation', async () => {
    const calls = stubFetch(() => new Response(JSON.stringify({ state: 'active', progress: { percentage: 10, message: 'Leyendo' } })))
    const { el, chooseFile, unmount } = await open()
    chooseFile()
    act(() => el.querySelector<HTMLInputElement>('#import-replace')!.click())
    act(() => button(el, 'Importar operaciones')!.click())
    await flush()
    expect(el.textContent).toContain(REPLACE_WARNING)
    expect(calls).toEqual([])
    act(() => button(el, 'Borrar y reemplazar')!.click())
    await flush()
    expect(calls[0]).toBe('/api/transactions/import?replace=true')
    unmount()
  })

  it('"Volver" backs out without importing', async () => {
    const calls = stubFetch(() => new Response('{}'))
    const { el, chooseFile, unmount } = await open()
    chooseFile()
    act(() => el.querySelector<HTMLInputElement>('#import-replace')!.click())
    act(() => button(el, 'Importar operaciones')!.click())
    act(() => button(el, 'Volver')!.click())
    await flush()
    expect(el.textContent).not.toContain(REPLACE_WARNING)
    expect(calls).toEqual([])
    unmount()
  })

  it('a plain import goes straight through', async () => {
    const calls = stubFetch(() => new Response(JSON.stringify({ state: 'active' })))
    const { el, chooseFile, unmount } = await open()
    chooseFile()
    act(() => button(el, 'Importar operaciones')!.click())
    await flush()
    expect(calls[0]).toBe('/api/transactions/import?replace=false')
    unmount()
  })
})

describe('ImportModal — errors a person can read', () => {
  it('lists the first 10 line errors, then "y N más", in plain words', async () => {
    const errors = Array.from({ length: 12 }, (_, i) => ({ line: i + 2, ticker: 'AAPL', error: 'Falta el precio' }))
    stubFetch(() => new Response(JSON.stringify({ state: 'completed', result: { success: false, imported: 0, failed: 12, errors } })))
    const { el, chooseFile, unmount } = await open()
    chooseFile()
    act(() => button(el, 'Importar operaciones')!.click())
    await act(async () => { await new Promise(r => setTimeout(r, 1100)) })
    const [title, options] = vi.mocked(toast.error).mock.calls.at(-1)!
    const html = renderToStaticMarkup(<>{(options as { description: React.ReactNode }).description}</>)
    expect(title).toBe('No se importó ninguna operación')
    expect(html.match(/<li/g)).toHaveLength(11)
    expect(html).toContain('Línea 2: Falta el precio')
    expect(html).toContain('y 2 más')
    expect(html).not.toMatch(/rollback/i)
    unmount()
  })

  it('a file the server cannot read shows the reason inside the modal', async () => {
    const calls = stubFetch(
      () => new Response('{}'),
      () => new Response(JSON.stringify({ error: 'Línea 3: Falta el campo FECHA', details: { line: 3, field: 'FECHA', message: 'Línea 3: Falta el campo FECHA' } }), { status: 400 }),
    )
    const { el, onClose, chooseFile, unmount } = await open()
    chooseFile()
    act(() => button(el, 'Importar operaciones')!.click())
    await flush()
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('Línea 3: Falta el campo FECHA')
    expect(onClose).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)
    unmount()
  })
})

describe('ImportModal — never drops a chosen file to a stray close', () => {
  it('with a file chosen, the X asks; without one it closes', async () => {
    const a = await open()
    act(() => a.el.querySelector<HTMLButtonElement>('button[aria-label="Cerrar"]')!.click())
    expect(a.onClose).toHaveBeenCalledTimes(1)
    a.unmount()

    const b = await open()
    b.chooseFile()
    act(() => b.el.querySelector<HTMLButtonElement>('button[aria-label="Cerrar"]')!.click())
    expect(b.onClose).not.toHaveBeenCalled()
    expect(b.el.textContent).toContain('Tenés datos sin guardar. ¿Descartarlos?')
    act(() => button(b.el, 'Descartar')!.click())
    expect(b.onClose).toHaveBeenCalledTimes(1)
    b.unmount()
  })
})
