// odd/tasks/ux-ons-y-operaciones.md S1, S6: section tabs, collapsed sections, plain-language glossary.
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Disclosure, Glossary, OnsTabs, ON_GLOSSARY } from '../ui'

describe('OnsTabs', () => {
  it('links the three views and marks the current one', () => {
    const html = renderToStaticMarkup(<OnsTabs current="explorar" />)
    expect(html).toMatch(/href="\/ons\/mi-cartera"[^>]*>Mis ONs</)
    expect(html).toMatch(/href="\/ons\/carteras"[^>]*>Carteras de prueba</)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toMatch(/<a aria-current="page"[^>]*href="\/ons">Explorar</)
  })
})

describe('Disclosure', () => {
  it('starts closed unless asked, with its title as a heading', () => {
    const closed = renderToStaticMarkup(<Disclosure title="Datos técnicos"><p>x</p></Disclosure>)
    expect(closed).not.toMatch(/<details[^>]*open/)
    expect(closed).toContain('<h2 class="inline')
    expect(renderToStaticMarkup(<Disclosure title="t" defaultOpen><p>x</p></Disclosure>)).toMatch(/<details[^>]*open/)
  })
})

describe('Glossary', () => {
  it('explains only the terms the page shows, in visible text', () => {
    const html = renderToStaticMarkup(<Glossary terms={['TIR', 'Duración']} />)
    expect(html).toContain('¿Qué significa cada dato?')
    expect(html).toContain(ON_GLOSSARY.TIR)
    expect(html).not.toContain(ON_GLOSSARY.Paridad)
    expect(html).not.toContain('title=')
  })
})
