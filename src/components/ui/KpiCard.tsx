import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type FigureTone = 'ok' | 'danger' | 'warn' | 'neutral' | 'muted'

const TONES: Record<FigureTone, string> = {
  ok: 'text-ok', danger: 'text-danger', warn: 'text-warn', neutral: 'text-ink', muted: 'text-ink-3',
}

export const toneOfResult = (n: number): FigureTone => (n > 0 ? 'ok' : n < 0 ? 'danger' : 'neutral')

/**
 * One figure of a statement row: label, value and optional captions below it.
 * Renders a dt/dd group, so it must sit inside a <dl>. The value arrives
 * formatted: results carry their sign, so color is never the only cue.
 */
export default function KpiCard({ label, value, tone = 'neutral', children }: {
  label: string
  value: ReactNode
  tone?: FigureTone
  children?: ReactNode
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-ink-3">{label}</dt>
      <dd className={cn('text-base font-medium tabular-nums', TONES[tone])}>{value}</dd>
      {children && <dd className="mt-0.5 break-words text-[13px] text-ink-3">{children}</dd>}
    </div>
  )
}
