import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AddTransactionModal from '../AddTransactionModal'
import ImportModal from '../ImportModal'

const noop = () => {}
/** The opening tag of the element with this id, whatever its attribute order. */
const tagWithId = (html: string, id: string) => html.match(new RegExp(`<[a-z]+[^>]*id="${id}"[^>]*>`))?.[0] ?? ''
const OLD_SYSTEM = /glass|text-amber|bg-bg-|font-mono|text-slate-|uppercase/

describe('AddTransactionModal restyle', () => {
  it('opens on a labelled dialog with a named close button', () => {
    const html = renderToStaticMarkup(<AddTransactionModal onClose={noop} onSuccess={noop} />)
    expect(html).toMatch(/<dialog[^>]*aria-labelledby="tx-title"/)
    expect(html).toContain('aria-label="Cerrar"')
    expect(html).toContain('Obligación negociable')
    expect(html).not.toMatch(OLD_SYSTEM)
  })

  it('associates every field with its label and offers the operation as a radio choice', () => {
    const html = renderToStaticMarkup(
      <AddTransactionModal onClose={noop} onSuccess={noop} initialData={{ assetClass: 'ACCION', ticker: 'AAPL', quantity: 10, price: 190.7 }} />,
    )
    for (const id of ['tx-date', 'tx-ticker', 'tx-quantity', 'tx-price', 'tx-commission', 'tx-notes']) {
      expect(html).toContain(`for="${id}"`)
      expect(html).toContain(`id="${id}"`)
    }
    expect(html).toMatch(/<input[^>]*type="radio"[^>]*checked=""[^>]*>Venta/)
    expect(html).toContain('190,70')
    expect(html).not.toMatch(OLD_SYSTEM)
  })
})

describe('ImportModal restyle', () => {
  const html = renderToStaticMarkup(<ImportModal onClose={noop} onSuccess={noop} />)

  it('makes the file picker and the replace option real, labelled, keyboard-reachable inputs', () => {
    expect(html).toMatch(/<label[^>]*for="import-file"/)
    expect(tagWithId(html, 'import-file')).toContain('type="file"')
    expect(tagWithId(html, 'import-file')).not.toContain('class="hidden"')
    expect(tagWithId(html, 'import-replace')).toContain('type="checkbox"')
    expect(html).toContain('for="import-replace"')
  })

  it('drops the old visual system', () => {
    expect(html).toMatch(/<dialog[^>]*aria-labelledby="import-title"/)
    expect(html).not.toMatch(/glass|text-amber|bg-bg-|font-mono|text-slate-/)
  })
})
