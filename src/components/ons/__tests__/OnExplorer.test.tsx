import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import OnExplorer, { DataStatus } from '../OnExplorer'
import type { OnListRow } from '@/lib/on-analytics'

vi.mock('next/navigation', () => ({ usePathname: () => '/ons', useSearchParams: () => new URLSearchParams() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals() })

const row = { isin: 'AR0000000001', tickerO: 'TSTAO', issuer: 'Emisor de Prueba', currencyLabel: 'USD MEP', law: 'NY', rateType: 'fixed', maturityDate: '2029-10-22', status: 'ok', price: 101.5, ytmPct: 6.09, adtvUsd: 1000, events: [], priceQuality: 'ok' } as unknown as OnListRow

async function mount(body: object) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<OnExplorer />) })
  return el
}

describe('OnExplorer', () => {
  // S4: status notices collapse to one line.
  it('puts every data condition in one status line, or none when all is fine', () => {
    const all = renderToStaticMarkup(<DataStatus data={{ asOf: '2026-10-20', stale: true, prices: { ok: false, fetchedAt: null } }} />)
    expect(all.match(/role="status"/g)).toHaveLength(1)
    expect(all).toContain('Catálogo desactualizado: datos de BYMA Educa del 20/10/2026 · Sin precios por ahora: no se calculan TIR ni duración.')
    expect(renderToStaticMarkup(<DataStatus data={{ asOf: '2026-10-20', stale: false, prices: { ok: true, quiet: true, fetchedAt: null } }} />))
      .toContain('Todavía no hubo operaciones hoy: precios de la última rueda.')
    expect(renderToStaticMarkup(<DataStatus data={{ asOf: '2026-10-20', stale: false, prices: { ok: true, fetchedAt: null } }} />)).toBe('')
  })

  // S4 and S6: sources and the glossary are collapsed sections at the end.
  it('shows the list with one status line, and the sources and glossary collapsed', async () => {
    const el = await mount({ rows: [row], asOf: '2026-10-20', stale: true, prices: { ok: true, quiet: true, fetchedAt: null } })
    expect(el.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(el.textContent).toContain('1 de 1 ONs')
    const details = [...el.querySelectorAll('details')]
    expect(details.map((d) => d.querySelector('h2')!.textContent)).toEqual(['Fuentes de los datos', '¿Qué significa cada dato?'])
    expect(details.every((d) => !d.open)).toBe(true)
    expect(details[0].textContent).toContain('BYMA Educa')
    expect(details[1].textContent).toContain('TIR')
  })

  it('an empty catalog says so instead of showing empty controls', async () => {
    const el = await mount({ rows: [], asOf: null, stale: false, prices: { ok: true, fetchedAt: null } })
    expect(el.textContent).toContain('El catálogo de ONs todavía no tiene datos')
    expect(el.querySelector('#on-q')).toBeNull()
  })
})
