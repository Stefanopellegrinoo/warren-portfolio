import AssetView from '@/components/asset/AssetView'
import { PAGE } from '@/components/ons/ui'

/** `BCBA:GGAL` may arrive still encoded (`BCBA%3AGGAL`): read it once, so it is never encoded twice. */
function decoded(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** The asset page (odd/tasks/asset-page.md S1). `?vs=AMZN,SE` replaces the default peers (S9). */
export default function AssetRoute({ params, searchParams }: {
  params: { ticker: string }
  searchParams: { vs?: string | string[] }
}) {
  const { vs } = searchParams
  return (
    <div className={PAGE}>
      <AssetView ticker={decoded(params.ticker)} vs={Array.isArray(vs) ? vs.join(',') : vs} />
    </div>
  )
}
