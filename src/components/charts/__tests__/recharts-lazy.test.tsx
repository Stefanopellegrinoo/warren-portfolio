import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// odd/tasks/rendimiento.md S9: recharts (~95 kB) arrives with the chart that draws it, never with the page.
const seen = { recharts: false }

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
beforeEach(() => {
  // A fresh module graph per test, and a fresh mock that notes when recharts is evaluated.
  vi.resetModules()
  seen.recharts = false
  vi.doMock('recharts', async (importOriginal) => {
    seen.recharts = true
    return importOriginal()
  })
})
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

describe('recharts loads only with the chart that needs it (S9)', () => {
  it.each([
    ['the statistics page', () => import('@/app/statistics/page')],
    ['an ON detail', () => import('@/components/ons/OnDetailLoader')],
    ['my ONs', () => import('@/components/ons/MyPortfolio')],
    ['a test portfolio', () => import('@/components/ons/portfolios/PortfolioBuilder')],
    ['Caja', () => import('@/app/cashflow/page')],
  ])('%s does not import recharts when its code loads', async (_, load) => {
    await load()
    expect(seen.recharts).toBe(false)
  })

  it('a chart holds its place while its code arrives, then draws', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    const { default: OnPriceChart } = await import('@/components/ons/OnPriceChart')
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    const history = [{ date: '2026-10-20', close: 99.5 }, { date: '2026-10-21', close: 100.25 }]
    await act(async () => { root.render(<OnPriceChart history={history} ticker="TSTD" />) })

    const box = el.querySelector('[role="img"]')!
    expect(box.getAttribute('aria-label')).toBe('Precio sucio de TSTD entre 20/10/2026 y 21/10/2026: de 99,50 a 100,25')
    await vi.waitFor(() => expect(box.querySelector('.recharts-responsive-container')).not.toBeNull())
    expect(seen.recharts).toBe(true)
    act(() => root.unmount())
  })
})

describe('next/dynamic calls the production build accepts', () => {
  it('pass their options as an object literal (a variable compiles in tests but fails `next build`)', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) { if (name !== '__tests__') walk(path) } else if (/\.tsx?$/.test(name)) files.push(path)
      }
    }
    walk(join(process.cwd(), 'src'))

    const offenders = files.filter(f => /dynamic\([^\n]*\)\s*,\s*[A-Za-z_$][\w$]*\s*\)/.test(readFileSync(f, 'utf8')))

    expect(offenders.map(f => f.slice(process.cwd().length + 1))).toEqual([])
  })
})
