import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DistributionList from '../DistributionList'

const items = [
  { label: 'Acciones', pct: 15.3, value: 13_480.5 },
  { label: 'CEDEARs', pct: 66.7, value: 58_763.9 },
  { label: 'Obligaciones negociables', pct: 0, value: 0 },
  { label: 'Caja', pct: 18, value: 15_856.93 },
]
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('DistributionList', () => {
  const html = renderToStaticMarkup(<DistributionList items={items} prefix="US$" />)

  it('draws a block per class that holds something', () => {
    expect(html.match(/data-block="[^"]+"/g)).toEqual(['data-block="CEDEARs"', 'data-block="Caja"', 'data-block="Acciones"'])
  })

  it('hides a class at 0 %', () => {
    expect(html).not.toContain('Obligaciones negociables')
  })

  it('always shows cash, even at 0 %', () => {
    const noCash = renderToStaticMarkup(<DistributionList items={[items[0], { label: 'Caja', pct: 0, value: 0 }]} prefix="US$" />)
    expect(text(noCash)).toContain('Caja 0,0 % US$ 0,00')
  })

  it('names every block with its share and amount, so color is never the only cue', () => {
    expect(text(html)).toContain('CEDEARs 66,7 % US$ 58.763,90')
    expect(text(html)).toContain('Acciones 15,3 % US$ 13.480,50')
    expect(text(html)).toContain('Caja 18,0 % US$ 15.856,93')
  })
})
