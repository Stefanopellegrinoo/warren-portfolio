import { redirect } from 'next/navigation'
import AssetView from '@/components/asset/AssetView'
import { PAGE } from '@/components/ons/ui'
import { parseTicker } from '@/lib/fundamentals/ticker'
import { resolveTickerIdentity } from '@/lib/ticker-identity'
import { loadOnAnalyses } from '@/lib/on-catalog'
import { createServiceClient } from '@/lib/supabase-server'

/** `BCBA:GGAL` may arrive still encoded (`BCBA%3AGGAL`): read it once, so it is never encoded twice. */
function decoded(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * The ISIN of an ON the app's catalog knows by this ticker (any of its lines) or ISIN; null otherwise.
 * Only for what Yahoo does not know, so an asset page never pays for the catalog. A failure keeps the page.
 */
async function onIsin(raw: string): Promise<string | null> {
  const t = parseTicker(raw)
  if (!t) return null
  try {
    if ((await resolveTickerIdentity(t)).found) return null
    const { analyses } = await loadOnAnalyses(createServiceClient())
    return analyses.find(({ row, detail }) => [row.isin, row.tickerO, row.tickerD, detail.tickerC].includes(t))?.row.isin ?? null
  } catch {
    return null
  }
}

/** The asset page (odd/tasks/asset-page.md S1). `?vs=AMZN,SE` replaces the default peers (S9). An ON opens its own page (T10). */
export default async function AssetRoute({ params, searchParams }: {
  params: { ticker: string }
  searchParams: { vs?: string | string[] }
}) {
  const ticker = decoded(params.ticker)
  const isin = await onIsin(ticker)
  if (isin) redirect(`/ons/${isin}`)
  const { vs } = searchParams
  return (
    <div className={PAGE}>
      <AssetView ticker={ticker} vs={Array.isArray(vs) ? vs.join(',') : vs} />
    </div>
  )
}
