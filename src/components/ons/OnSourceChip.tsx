import { cn } from '@/lib/utils'
import { fmtDate, safeHref } from '@/lib/on-format'
import type { Prov } from '@/lib/bond-math'

interface Props {
  prov: Prov
  sourceUrl?: string
  verifiedAt?: string | null
  className?: string
}

const STYLE = {
  verified: 'border-emerald/30 bg-emerald/10 text-emerald',
  byma: 'border-sky/30 bg-sky/10 text-sky',
  unverified: 'border-amber/30 bg-amber/10 text-amber',
}

/** Provenance of one term: verificado (primary source) / BYMA / sin verificar. */
export default function OnSourceChip({ prov, sourceUrl, verifiedAt, className }: Props) {
  const unverified = prov === 'secondary' || prov === 'default'
  const label = prov === 'verified' ? 'verificado' : prov === 'byma' ? 'BYMA' : 'sin verificar'
  const title =
    prov === 'verified'
      ? `Verificado contra la fuente primaria${verifiedAt ? ` el ${fmtDate(verifiedAt)}` : ''}`
      : prov === 'byma'
        ? 'Dato de BYMA Educa, sin verificar contra el prospecto'
        : prov === 'secondary'
          ? 'Fuente secundaria: sin verificar contra el prospecto'
          : 'Valor por defecto según la ley aplicable: sin verificar contra el prospecto'
  const href = safeHref(sourceUrl)
  const cls = cn('inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-mono leading-none', STYLE[prov === 'verified' ? 'verified' : unverified ? 'unverified' : 'byma'], className)
  const text = prov === 'verified' && verifiedAt ? `${label} ${fmtDate(verifiedAt)}` : label
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" title={`${title}. Ver fuente`} className={cn(cls, 'hover:brightness-125 underline-offset-2 hover:underline')}>
      {text}
    </a>
  ) : (
    <span title={title} className={cls}>
      {text}
    </span>
  )
}
