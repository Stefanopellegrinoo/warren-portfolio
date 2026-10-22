import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AddTransactionModal from '../AddTransactionModal'

const render = (initialData: React.ComponentProps<typeof AddTransactionModal>['initialData']) =>
  renderToStaticMarkup(<AddTransactionModal onClose={() => {}} onSuccess={() => {}} initialData={initialData} />)

describe('AddTransactionModal quick-sell header', () => {
  it('shows ON holdings as real VN (ledger quantity x 100)', () => {
    const html = render({ assetClass: 'ON', ticker: 'AAA', quantity: 200, price: 98.5 })
    expect(html).toContain('20.000 VN')
    expect(html).not.toContain('200 nominales')
  })
})
