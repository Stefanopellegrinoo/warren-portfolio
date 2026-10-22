import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ONsSection from '../ONsSection'
import type { ONPosition } from '@/types'

const pos = (over: Partial<ONPosition>): ONPosition => ({
  id: 'p1', user_id: 'u', ticker: 'AAA', quantity: 200, avg_cost: 98.5, total_invested: 19700,
  first_bought: null, last_updated: '2026-01-01', version: 1, ...over,
})
const render = (p: ONPosition) => renderToStaticMarkup(<ONsSection positions={[p]} />)

describe('ONsSection nominal (VN) column', () => {
  it('labels the column VN, not NOMINALES', () => {
    const html = render(pos({}))
    expect(html).not.toContain('NOMINALES')
    expect(html).toMatch(/>VN</)
  })

  it('shows real VN (ledger quantity x 100) formatted es-AR', () => {
    expect(render(pos({ quantity: 200 }))).toContain('20.000')
    expect(render(pos({ quantity: 1234.56 }))).toContain('123.456')
  })

  it('does not show the raw ledger quantity as the nominal cell', () => {
    expect(render(pos({ quantity: 777 }))).not.toMatch(/>777</)
  })
})

describe('ONsSection average price (per 100 VN, in USD)', () => {
  it.each([
    [98.5, 'US$ 98,50'],
    [53, 'US$ 53,00'],
    [5, 'US$ 5,00'], // distressed bond under 10 per 100 VN: must NOT become "500%"
    [0.5, 'US$ 0,50'],
  ])('avg_cost %s renders as a USD price', (avg_cost, expected) => {
    const html = render(pos({ avg_cost }))
    expect(html).toContain(expected)
    expect(html).not.toMatch(/\d+%<\/td>/)
  })
})
