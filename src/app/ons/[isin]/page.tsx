import OnDetailLoader from '@/components/ons/OnDetailLoader'
import { PAGE } from '@/components/ons/ui'

export default function OnDetailPage({ params }: { params: { isin: string } }) {
  return (
    <div className={PAGE}>
      <OnDetailLoader isin={params.isin.toUpperCase()} />
    </div>
  )
}
