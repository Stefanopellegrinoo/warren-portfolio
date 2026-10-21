import Link from 'next/link'
import PortfolioList from '@/components/ons/portfolios/PortfolioList'

export default function CarterasPage() {
  return (
    <div className="min-h-screen pb-20 md:pb-0 md:pl-56">
      <div className="space-y-6 p-4 md:p-8">
        <Link href="/ons" className="inline-block text-sm text-slate-400 hover:text-white">← Volver al listado</Link>
        <header>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">Carteras de prueba de ONs</h1>
          <p className="mt-1 text-sm text-slate-400">Combiná ONs con montos hipotéticos y mirá el calendario de cobros, la TIR y la concentración de la cartera.</p>
        </header>
        <PortfolioList />
      </div>
    </div>
  )
}
