import { Suspense } from 'react'
import OnExplorer from '@/components/ons/OnExplorer'
import { OnsTabs, PAGE, PageHeader } from '@/components/ons/ui'

export default function OnsPage() {
  return (
    <div className={PAGE}>
      <PageHeader title="Obligaciones negociables">
        <OnsTabs current="explorar" />
      </PageHeader>
      <Suspense fallback={null}>
        <OnExplorer />
      </Suspense>
    </div>
  )
}
