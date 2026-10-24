import PortfolioList from '@/components/ons/portfolios/PortfolioList'
import { OnsTabs, PAGE, PageHeader } from '@/components/ons/ui'

export default function CarterasPage() {
  return (
    <div className={PAGE}>
      <PageHeader title="Obligaciones negociables">
        <OnsTabs current="carteras" />
      </PageHeader>
      <PortfolioList />
    </div>
  )
}
