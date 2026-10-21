import { fmtNum } from '@/lib/on-format'
import type { MyOnPortfolio } from '@/lib/on-my-portfolio'
import PortfolioResults from './portfolios/PortfolioResults'

export type MyPortfolioData = MyOnPortfolio & { asOf: string | null; stale: boolean }

export default function MyPortfolioView({ data }: { data: MyPortfolioData }) {
  const { analysis, unmapped, stale } = data
  const nothing = analysis.empty && unmapped.length === 0 && analysis.skipped.length === 0
  if (nothing) return <div className="glass rounded-2xl p-6 text-sm text-slate-300">No tenés ONs en cartera. Cuando cargues una compra, acá vas a ver el calendario de cobros.</div>
  return (
    <div className="space-y-5">
      {stale && <p role="status" className="rounded-xl border border-amber/30 bg-amber/10 px-4 py-3 text-sm text-amber">El catálogo de ONs no se actualizó hoy: los cobros y precios pueden estar desfasados.</p>}
      <PortfolioResults held analysis={analysis} />
      {unmapped.length > 0 && (
        <section className="glass rounded-2xl p-5" aria-labelledby="mc-unmapped">
          <h2 id="mc-unmapped" className="mb-3 font-display text-sm font-bold uppercase tracking-widest text-slate-300">Sin términos en el catálogo</h2>
          <ul className="space-y-1 font-mono text-sm text-slate-200">
            {unmapped.map((u) => <li key={u.ticker}>{u.ticker} · VN {fmtNum(u.vn, 0)}</li>)}
          </ul>
          <p className="mt-3 text-[11px] text-slate-400">Estas posiciones no se encontraron en el catálogo (vencidas, en pesos o con otro ticker), por eso no entran en la proyección.</p>
        </section>
      )}
    </div>
  )
}
