'use client'

import { useCached } from '@/lib/client-cache'
import { argentinaDate } from '@/lib/utils'
import { requestErrorMessage } from '@/lib/request-errors'
import { apiData } from '@/components/ons/portfolios/api'
import { Loading, LoadError } from '@/components/ons/ui'
import type { AssetNews } from '@/lib/fundamentals/news'

const DAY_MS = 86_400_000
const dayMonth = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', timeZone: 'America/Argentina/Buenos_Aires' })
const FAILED = { es: 'No pudimos traer las noticias en español.', en: 'No pudimos traer las noticias en inglés.' }
const ALL_FAILED = 'No pudimos traer las noticias.'

/** "hace 5 min", "hace 3 h", "ayer" (Argentine calendar), "12 oct", "2 sep 2025". */
function age(iso: string, now: Date): string {
  const t = new Date(iso)
  const min = Math.max(1, Math.floor((now.getTime() - t.getTime()) / 60_000))
  if (min < 60) return `hace ${min} min`
  if (min < 24 * 60) return `hace ${Math.floor(min / 60)} h`
  const day = argentinaDate(t)
  if (day === argentinaDate(new Date(now.getTime() - DAY_MS))) return 'ayer'
  return day.slice(0, 4) === argentinaDate(now).slice(0, 4) ? dayMonth.format(t) : `${dayMonth.format(t)} ${day.slice(0, 4)}`
}

/** The asset page's Noticias (odd/tasks/asset-page.md S10): one request to /api/asset/<ticker>/news, remembered in this tab. */
export function NoticiasTab({ ticker, name }: { ticker: string; name: string }) {
  const url = `/api/asset/${encodeURIComponent(ticker)}/news`
  const { data, error, reload } = useCached(`asset-news:${url}`, () => apiData<AssetNews>(url))

  if (!data) {
    if (error) return <LoadError message={requestErrorMessage(error, ALL_FAILED)} onRetry={reload} />
    return <Loading label="Cargando noticias" />
  }
  const { items, sources } = data
  if (sources.es === 'error' && sources.en === 'error') return <LoadError message={ALL_FAILED} onRetry={reload} />

  const now = new Date()
  return (
    <section aria-label={`Noticias de ${name}`} className="max-w-3xl">
      {(['es', 'en'] as const).filter((l) => sources[l] === 'error').map((l) => (
        <p key={l} className="mb-2 text-[15px] text-ink-2">{FAILED[l]}</p>
      ))}
      {items.length === 0 ? (
        <p className="py-6 text-[15px] text-ink-2">Todavía no hay noticias de esta empresa.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((i, n) => (
            <li key={`${n}:${i.link}`} className="py-3">
              <a
                href={i.link}
                target="_blank"
                rel="noopener noreferrer"
                lang={i.lang === 'en' ? 'en' : undefined}
                className="block min-h-11 break-words py-1 text-base font-medium leading-snug text-ink hover:underline"
              >
                {i.title}
              </a>
              <p className="text-[15px] leading-6 text-ink-2">
                {i.lang === 'en' && (
                  <span data-lang-tag title="En inglés" className="mr-2 inline-block rounded border border-line-strong px-1.5 align-middle text-[13px] font-semibold leading-5 text-ink-2">EN</span>
                )}
                {i.source} · <time dateTime={i.publishedAt}>{age(i.publishedAt, now)}</time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
