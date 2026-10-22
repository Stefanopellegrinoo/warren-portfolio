import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import UnpricedNotice from '../UnpricedNotice'

describe('UnpricedNotice', () => {
  it('renders nothing for 0, missing or old-payload values', () => {
    expect(renderToStaticMarkup(<UnpricedNotice count={0} tickers={[]} />)).toBe('')
    expect(renderToStaticMarkup(<UnpricedNotice />)).toBe('')
    expect(renderToStaticMarkup(<UnpricedNotice count={undefined} tickers={undefined} />)).toBe('')
  })

  it('names the count and tickers in text, role=status, pluralised', () => {
    const many = renderToStaticMarkup(<UnpricedNotice count={2} tickers={['AAA', 'BBB']} />)
    expect(many).toContain('role="status"')
    expect(many).toContain('bg-warn-soft')
    expect(many).toContain('2 posiciones sin precio (AAA, BBB) — no están incluidas en el total')
    const one = renderToStaticMarkup(<UnpricedNotice count={1} tickers={['AAA']} />)
    expect(one).toContain('1 posición sin precio (AAA) — no está incluida en el total')
  })

  it('omits the parenthesis when tickers are missing', () => {
    const html = renderToStaticMarkup(<UnpricedNotice count={3} />)
    expect(html).toContain('3 posiciones sin precio — no están incluidas en el total')
    expect(html).not.toContain('()')
  })
})
