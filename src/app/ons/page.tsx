import Link from 'next/link'
import { Suspense } from 'react'
import OnExplorer from '@/components/ons/OnExplorer'

export default function OnsPage() {
  return (
    <div className="min-h-screen">
      <div className="space-y-6 p-4 md:p-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-white">Obligaciones negociables</h1>
            <p className="mt-1 text-sm text-slate-400">Explorá el mercado de ONs: rendimiento, duración y condiciones de emisión.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/ons/mi-cartera" className="btn-ghost">Mi cartera de ONs</Link>
            <Link href="/ons/carteras" className="btn-ghost">Mis carteras de prueba</Link>
          </div>
        </header>
        <Suspense fallback={null}>
          <OnExplorer />
        </Suspense>
      </div>
    </div>
  )
}
