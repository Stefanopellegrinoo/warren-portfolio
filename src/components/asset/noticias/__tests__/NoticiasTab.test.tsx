import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { forgetCached } from '@/lib/client-cache'
import type { AssetNews, NewsItem } from '@/lib/fundamentals/news'
import { NoticiasTab } from '../NoticiasTab'

// odd/tasks/asset-page.md T8, S10. Every title, source and link is invented.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = new Date('2026-10-30T15:00:00Z')
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); forgetCached(); document.body.innerHTML = '' })

const item = (title: string, publishedAt: string, lang: 'es' | 'en' = 'es', source = 'Diario Uno'): NewsItem =>
  ({ title, link: `https://example.com/${title.length}`, source, publishedAt, lang })

const NEWS: AssetNews = {
  items: [
    item('Acme abre un local', '2026-10-30T14:55:00Z'),
    item('Acme sube 5%', '2026-10-30T12:00:00Z'),
    item('Acme reparte dividendos', '2026-10-29T10:00:00Z'),
    item('Acme presenta su balance', '2026-10-12T15:00:00Z'),
    item('Acme cambia de director', '2025-09-02T15:00:00Z'),
    item('Acme beats estimates', '2026-10-30T13:00:00Z', 'en', 'Wire Daily'),
  ],
  sources: { es: 'ok', en: 'ok' },
}

async function show(answers: (Response | Promise<Response>)[], ticker = 'BCBA:ACMA') {
  forgetCached()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url)
    return answers[Math.min(urls.length, answers.length) - 1]
  }))
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<NoticiasTab ticker={ticker} name="Acme Argentina S.A." />) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  return { el, urls, text: () => el.textContent ?? '', unmount: () => act(() => root.unmount()) }
}

describe('NoticiasTab', () => {
  it('lists each headline as a link that opens in a new tab, with its source and age', async () => {
    const { el, urls, unmount } = await show([Response.json(NEWS)])
    expect(urls).toEqual(['/api/asset/BCBA%3AACMA/news'])

    const links = [...el.querySelectorAll('a')]
    expect(links.map((a) => a.textContent)).toEqual(NEWS.items.map((i) => i.title))
    for (const [i, a] of links.entries()) {
      expect(a.getAttribute('href')).toBe(NEWS.items[i].link)
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    }
    const meta = [...el.querySelectorAll('li')].map((li) => li.querySelector('p')!.textContent)
    expect(meta).toEqual([
      'Diario Uno · hace 5 min',
      'Diario Uno · hace 3 h',
      'Diario Uno · ayer',
      'Diario Uno · 12 oct',
      'Diario Uno · 2 sep 2025',
      'ENWire Daily · hace 2 h',
    ])
    unmount()
  })

  it('tags English headlines with EN, and only those', async () => {
    const { el, unmount } = await show([Response.json(NEWS)])
    const tagged = [...el.querySelectorAll('li')].filter((li) => li.querySelector('[data-lang-tag]'))
    expect(tagged.map((li) => li.querySelector('a')!.textContent)).toEqual(['Acme beats estimates'])
    expect(tagged[0].querySelector('a')!.getAttribute('lang')).toBe('en')
    unmount()
  })

  it('says so when there are no headlines', async () => {
    const { el, text, unmount } = await show([Response.json({ items: [], sources: { es: 'ok', en: 'ok' } })])
    expect(text()).toContain('Todavía no hay noticias de esta empresa')
    expect(el.querySelector('a')).toBeNull()
    unmount()
  })

  it('adds a short note when one source failed', async () => {
    const { text, unmount } = await show([Response.json({ ...NEWS, sources: { es: 'ok', en: 'error' } })])
    expect(text()).toContain('No pudimos traer las noticias en inglés.')
    expect(text()).toContain('Acme sube 5%')
    unmount()

    const es = await show([Response.json({ items: [], sources: { es: 'error', en: 'ok' } })])
    expect(es.text()).toContain('No pudimos traer las noticias en español.')
    expect(es.text()).toContain('Todavía no hay noticias de esta empresa')
    es.unmount()
  })

  it('shows an error with a retry when the request or both sources fail, and retries', async () => {
    const both = await show([Response.json({ items: [], sources: { es: 'error', en: 'error' } })])
    expect(both.el.querySelector('[role="alert"]')!.textContent).toContain('No pudimos traer las noticias.')
    both.unmount()

    const { el, urls, text, unmount } = await show([Response.json({ error: 'Algo salió mal' }, { status: 500 }), Response.json(NEWS)])
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('Algo salió mal')
    await act(async () => { el.querySelector<HTMLButtonElement>('[role="alert"] button')!.click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(urls).toHaveLength(2)
    expect(text()).toContain('Acme sube 5%')
    unmount()
  })

  it('shows a loading state until the answer arrives', async () => {
    const { el, unmount } = await show([new Promise<Response>(() => {})])
    expect(el.querySelector('[role="status"]')!.getAttribute('aria-label')).toBe('Cargando noticias')
    unmount()
  })
})
