import Link from 'next/link'
import { cn } from '@/lib/utils'

export type Tone = 'ok' | 'danger' | 'warn' | 'neutral'

const TONES: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok before:bg-ok-dot',
  danger: 'bg-danger-soft text-danger before:bg-danger-dot',
  warn: 'bg-warn-soft text-warn before:bg-warn-dot',
  neutral: 'bg-neutral-soft text-neutral before:bg-neutral-dot',
}

/** Status chip: dot plus text, never color alone. */
export function Chip({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn(
      'inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded px-2 text-xs font-medium leading-none tabular-nums before:h-1.5 before:w-1.5 before:rounded-full',
      TONES[tone], className,
    )}>
      {children}
    </span>
  )
}

export function toneOf(n: number | null): Tone {
  if (n === null) return 'neutral'
  return n > 0 ? 'ok' : n < 0 ? 'danger' : 'neutral'
}

export function SectionHead({ id, title, count, action }: {
  id: string
  title: string
  count?: number
  action?: { href: string; label: string } | React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line pb-3">
      <h2 id={id} className="text-base font-semibold tracking-[-0.005em]">
        {title}
        {count !== undefined && <span className="ml-1 font-normal text-ink-3">{count}</span>}
      </h2>
      {action && typeof action === 'object' && 'href' in action
        ? <Link href={action.href} className="inline-flex min-h-6 items-center text-[13px] font-medium text-accent-ink hover:underline hover:underline-offset-2">{action.label}</Link>
        : action}
    </div>
  )
}

export function GroupHead({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-1 mt-5 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.06em] text-ink-3">{children}</h3>
}

export const linkButton = 'inline-flex min-h-6 items-center font-medium text-accent-ink hover:underline hover:underline-offset-2 max-[819px]:min-h-11'
