import Link from 'next/link'
import { Suspense } from 'react'
import OnExplorer from '@/components/ons/OnExplorer'
import { PAGE, PageHeader, btnSecondary } from '@/components/ons/ui'

export default function OnsPage() {
  return (
    <div className={PAGE}>
      <PageHeader
        title="Obligaciones negociables"
        intro="Explorá el mercado de ONs: rendimiento, duración y condiciones de emisión."
        actions={
          <>
            <Link href="/ons/mi-cartera" className={btnSecondary}>Mi cartera de ONs</Link>
            <Link href="/ons/carteras" className={btnSecondary}>Mis carteras de prueba</Link>
          </>
        }
      />
      <Suspense fallback={null}>
        <OnExplorer />
      </Suspense>
    </div>
  )
}
