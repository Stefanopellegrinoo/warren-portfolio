import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import OnSourceChip from '../OnSourceChip'

describe('OnSourceChip', () => {
  it('verified: shows "verificado", the date and a source link', () => {
    const html = renderToStaticMarkup(<OnSourceChip prov="verified" sourceUrl="https://example.org/p.pdf" verifiedAt="2026-10-21" />)
    expect(html).toContain('verificado')
    expect(html).toContain('21/10/2026')
    expect(html).toContain('href="https://example.org/p.pdf"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('secondary and default both read "sin verificar"; only the first has a source', () => {
    const secondary = renderToStaticMarkup(<OnSourceChip prov="secondary" sourceUrl="https://example.org/s" verifiedAt={null} />)
    expect(secondary).toContain('sin verificar')
    expect(secondary).toContain('href="https://example.org/s"')
    const dflt = renderToStaticMarkup(<OnSourceChip prov="default" />)
    expect(dflt).toContain('sin verificar')
    expect(dflt).not.toContain('<a ')
  })

  it('byma reads "BYMA"', () => {
    expect(renderToStaticMarkup(<OnSourceChip prov="byma" />)).toContain('BYMA')
  })

  it('never renders a non-http source link', () => {
    const html = renderToStaticMarkup(<OnSourceChip prov="verified" sourceUrl="javascript:alert(1)" verifiedAt="2026-10-21" />)
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<a ')
  })

  it('explains itself to assistive tech through a title', () => {
    expect(renderToStaticMarkup(<OnSourceChip prov="default" />)).toContain('title="')
  })
})
