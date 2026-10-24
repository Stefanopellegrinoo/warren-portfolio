import MyPortfolio from '@/components/ons/MyPortfolio'
import { OnsTabs, PAGE, PageHeader } from '@/components/ons/ui'

export default function MiCarteraPage() {
  return (
    <div className={PAGE}>
      <PageHeader title="Obligaciones negociables">
        <OnsTabs current="mi-cartera" />
      </PageHeader>
      <MyPortfolio />
    </div>
  )
}
