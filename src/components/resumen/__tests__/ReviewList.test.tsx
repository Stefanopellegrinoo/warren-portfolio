import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ReviewList from '../ReviewList'

describe('ReviewList', () => {
  it('renders nothing when there is nothing to review', () => {
    expect(renderToStaticMarkup(<ReviewList items={[]} />)).toBe('')
  })

  it('uses the item link, so bonds go to the ON portfolio', () => {
    const html = renderToStaticMarkup(<ReviewList items={[{ ticker: 'YMCJO', name: null, tone: 'danger', chip: '−40,0 %', why: 'x', href: '/ons/mi-cartera' }]} />)
    expect(html).toContain('href="/ons/mi-cartera"')
    expect(html).not.toContain('/trading')
  })

  it('shows each item with its reason, a text chip and a link to its chart', () => {
    const html = renderToStaticMarkup(
      <ReviewList items={[{ ticker: 'SLB', name: 'Schlumberger', tone: 'danger', chip: '−48,9 %', why: 'Pierde 489 desde la compra', href: '/trading?symbol=SLB' }]} />,
    )
    expect(html).toContain('Para revisar')
    expect(html).toContain('SLB, Schlumberger')
    expect(html).toContain('−48,9 %')
    expect(html).toContain('Pierde 489 desde la compra')
    expect(html).toContain('href="/trading?symbol=SLB"')
  })
})
