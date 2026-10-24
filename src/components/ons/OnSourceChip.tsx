import { cn } from '@/lib/utils'
import { fmtDate, safeHref } from '@/lib/on-format'
import type { Prov } from '@/lib/bond-math'
import { tag } from './ui'

interface Props {
  prov: Prov
  sourceUrl?: string
  verifiedAt?: string | null
  className?: string
}

const TONE = { verified: 'ok', byma: 'info', unverified: 'warn' } as const
// A 22px chip with a 44px tap area on phones (the dot already uses `before:`).
const HIT = 'relative max-[819px]:after:absolute max-[819px]:after:inset-x-0 max-[819px]:after:-inset-y-[11px]'

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
  const cls = cn(tag(TONE[prov === 'verified' ? 'verified' : unverified ? 'unverified' : 'byma']), className)
  const text = prov === 'verified' && verifiedAt ? `${label} ${fmtDate(verifiedAt)}` : label
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" title={`${title}. Ver fuente`} className={cn(cls, HIT, 'underline decoration-1 underline-offset-2 hover:decoration-2')}>
      {text}
    </a>
  ) : (
    <span title={title} className={cn(cls, 'cursor-help')}>
      {text}
    </span>
  )
}
