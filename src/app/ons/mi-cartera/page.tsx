import Link from 'next/link'
import MyPortfolio from '@/components/ons/MyPortfolio'

export default function MiCarteraPage() {
  return (
    <div className="min-h-screen pb-20 md:pb-0 md:pl-56">
      <div className="space-y-6 p-4 md:p-8">
        <Link href="/ons" className="inline-block text-sm text-slate-400 hover:text-white">← Volver al listado</Link>
        <header>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">Mi cartera de ONs</h1>
          <p className="mt-1 text-sm text-slate-400">Los cobros futuros de las ONs que tenés hoy: calendario mensual, ingreso anual, vencimientos y TIR al precio actual. Solo lectura.</p>
        </header>
        <MyPortfolio />
      </div>
    </div>
  )
}
