import PortfolioBuilder from '@/components/ons/portfolios/PortfolioBuilder'
import { PAGE } from '@/components/ons/ui'

export default function CarteraPage({ params }: { params: { id: string } }) {
  return (
    <div className={PAGE}>
      <PortfolioBuilder id={params.id} />
    </div>
  )
}
