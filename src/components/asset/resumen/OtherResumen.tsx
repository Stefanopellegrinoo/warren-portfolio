'use client'

import type { AssetPage } from '@/lib/fundamentals/service'
import { formatMetric } from '@/lib/fundamentals/explain'
import { priceText } from '@/components/trading/ui'
import { signTone } from '@/components/ons/ui'
import { formatNumber, formatPct } from '@/lib/utils'
import { Card, Facts, Range } from './ResumenTab'

const NB = ' '
const longDate = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
/** "0,09 %" never breaks before its sign. */
const keepPct = (s: string) => s.replace(/ %/g, `${NB}%`)
const pct = (v: number | null, sign = false) => (v === null ? null : keepPct(formatPct(v, { digits: sign ? 1 : 2, sign })))
const usd = (v: number | null | undefined) => (v == null ? null : formatMetric(v, 'usd'))

function Missing({ children }: { children: string }) {
  return <p className="rounded-md bg-surface-2 px-4 py-3 text-[15px] text-ink-2">{children}</p>
}

/** Yahoo's prices compare with the header's only in the same currency. */
const sameCurrency = (page: AssetPage) => !page.profile?.currency || !page.currency || page.profile.currency === page.currency

/**
 * An ETF's Resumen (odd/tasks/asset-page.md T10, S1; design goal 9): what it returned, what it costs, how big it
 * is, its 52 weeks and who runs it. Facts, never advice.
 */
export function FundResumen({ page }: { page: AssetPage }) {
  const p = page.profile
  const f = p?.fund
  if (!p || !f) return <Missing>No pudimos traer los datos del fondo. Probá de nuevo en un rato.</Missing>
  const ret = (v: number | null) => ({ v: pct(v, true), tone: v === null ? undefined : signTone(v) })
  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <Card title="Cuánto rindió">
        <Facts
          rows={[
            { k: 'En lo que va del año', ...ret(f.ytdReturn) },
            { k: 'Por año, últimos 3 años', ...ret(f.threeYearReturn) },
            { k: 'Por año, últimos 5 años', ...ret(f.fiveYearReturn) },
          ]}
        />
        <p className="mt-3 border-t border-line pt-3 text-[15px] text-ink-2">Lo que rindió no dice lo que va a rendir.</p>
      </Card>
      <Card title="Costos y tamaño">
        <Facts
          rows={[
            { k: 'Gastos por año', v: pct(f.expenseRatio), hint: 'Lo que el fondo descuenta cada año de lo invertido.' },
            { k: 'Rendimiento por dividendos', v: pct(f.yield), hint: 'Lo que pagó en un año, sobre su precio.' },
            { k: 'Activos del fondo', v: usd(f.totalAssets), hint: 'Todo lo que administra.' },
          ]}
        />
      </Card>
      <Card title="Últimas 52 semanas"><Range page={page} p={p} same={sameCurrency(page)} /></Card>
      <Card title="El fondo">
        <Facts
          rows={[
            // Yahoo's categories stay in English, like the industries: their names are what people search.
            { k: 'Categoría', v: f.category, lang: 'en' },
            { k: 'Administradora', v: f.family },
            { k: 'Desde', v: f.inceptionDate && longDate.format(new Date(`${f.inceptionDate}T00:00:00Z`)) },
          ]}
        />
      </Card>
    </div>
  )
}

/**
 * A coin's Resumen (T10): its market from Yahoo (price, the day's change, market cap, coins in circulation,
 * 24 h volume) and its 52 weeks. Yahoo's crypto day starts at 0 h UTC, 21 h in Argentina.
 */
export function CryptoResumen({ page }: { page: AssetPage }) {
  const p = page.profile
  if (!p) return <Missing>No pudimos traer los datos de esta criptomoneda. Probá de nuevo en un rato.</Missing>
  const coin = page.ticker.replace(/-USD$/, '')
  const change = p.dayChange
  const cur = p.currency === 'USD' || !p.currency ? 'US$' : p.currency
  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <Card title="Mercado">
        <Facts
          rows={[
            { k: 'Precio', v: p.regularMarketPrice == null ? null : `${cur}${NB}${priceText(p.regularMarketPrice)}` },
            {
              k: 'Cambio del día',
              v: change && keepPct(`${formatPct(change.pct)} (${formatNumber(change.abs, { decimals: Math.abs(change.abs) < 1 ? 4 : 2, sign: true })})`),
              tone: change ? signTone(change.abs) : undefined,
              hint: 'Desde las 21 h de Argentina (0 h UTC).',
            },
            { k: 'Capitalización', v: usd(p.marketCap), hint: 'Precio por monedas en circulación.' },
            { k: 'En circulación', v: p.circulatingSupply == null ? null : `${formatMetric(p.circulatingSupply, 'count')}${NB}${coin}` },
            { k: 'Volumen en 24 horas', v: usd(p.volume24h), hint: 'Lo que se operó en las últimas 24 horas.' },
          ]}
        />
      </Card>
      <Card title="Últimas 52 semanas"><Range page={page} p={p} same={sameCurrency(page)} /></Card>
    </div>
  )
}
