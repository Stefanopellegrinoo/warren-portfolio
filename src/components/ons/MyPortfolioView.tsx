import { fmtNum } from '@/lib/on-format'
import type { MyOnPortfolio } from '@/lib/on-my-portfolio'
import Link from 'next/link'
import { SectionHead } from '@/components/resumen/ui'
import PortfolioResults from './portfolios/PortfolioResults'
import { notice } from './ui'

export type MyPortfolioData = MyOnPortfolio & { asOf: string | null; stale: boolean }

export default function MyPortfolioView({ data }: { data: MyPortfolioData }) {
  const { analysis, unmapped, stale } = data
  const nothing = analysis.empty && unmapped.length === 0 && analysis.skipped.length === 0
  if (nothing) {
    return (
      <p className="py-4 text-ink-2">
        No tenés ONs en cartera. Cuando cargues una compra, acá vas a ver el calendario de cobros.{' '}
        <Link href="/ons" className="font-medium text-accent-ink underline underline-offset-2">Explorar ONs</Link>
      </p>
    )
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10">
      {stale && <p role="status" className={notice('warn')}>El catálogo de ONs no se actualizó hoy: los cobros y precios pueden estar desfasados.</p>}
      <PortfolioResults held analysis={analysis} />
      {unmapped.length > 0 && (
        <section aria-labelledby="mc-unmapped">
          <SectionHead id="mc-unmapped" title="Sin términos en el catálogo" count={unmapped.length} />
          <ul>
            {unmapped.map((u) => (
              <li key={u.ticker} className="flex min-h-11 items-center justify-between gap-3 border-b border-line py-2 tabular-nums last:border-b-0">
                <span className="font-semibold">{u.ticker}</span><span className="text-ink-2">VN {fmtNum(u.vn, 0)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-ink-3">Estas posiciones no se encontraron en el catálogo (vencidas, en pesos o con otro ticker), por eso no entran en la proyección.</p>
        </section>
      )}
    </div>
  )
}
