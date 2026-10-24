'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

/**
 * A destructive action that asks next to its button instead of a native confirm():
 * the question, a specific confirm label and Cancelar, which takes the focus.
 */
export function InlineConfirm({ question, confirmLabel, onConfirm, busy = false, triggerLabel, triggerClassName, children }: {
  question: string
  confirmLabel: string
  onConfirm: () => void
  busy?: boolean
  triggerLabel?: string
  triggerClassName?: string
  children: React.ReactNode
}) {
  const [asking, setAsking] = useState(false)

  if (!asking) {
    return (
      <button type="button" aria-label={triggerLabel} disabled={busy} onClick={() => setAsking(true)}
        className={triggerClassName ?? cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
        {children}
      </button>
    )
  }
  return (
    <span role="group" aria-label={question} className="inline-flex flex-wrap items-center gap-2"
      onKeyDown={(e) => { if (e.key === 'Escape') setAsking(false) }}>
      <span className="text-[13px] font-medium text-danger">{question}</span>
      <button type="button" className={cn(buttonVariants({ variant: 'destructive', size: 'sm' }))}
        onClick={() => { setAsking(false); onConfirm() }}>
        {confirmLabel}
      </button>
      <button type="button" autoFocus className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))} onClick={() => setAsking(false)}>
        Cancelar
      </button>
    </span>
  )
}
