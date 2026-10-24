'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

/**
 * A destructive action that asks next to its button instead of a native confirm():
 * the question, a specific confirm label and Cancelar, which takes the focus.
 * `className` places the question, e.g. on its own line in a narrow grid row.
 */
export function InlineConfirm({ question, confirmLabel, onConfirm, busy = false, triggerLabel, triggerClassName, className, children }: {
  question: string
  confirmLabel: string
  onConfirm: () => void
  busy?: boolean
  triggerLabel?: string
  triggerClassName?: string
  className?: string
  children: React.ReactNode
}) {
  const [asking, setAsking] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  // Like a native confirm, backing out returns the focus to the action.
  const refocus = useRef(false)
  useEffect(() => {
    if (!asking && refocus.current) { refocus.current = false; trigger.current?.focus() }
  }, [asking])
  const cancel = () => { refocus.current = true; setAsking(false) }

  if (!asking) {
    return (
      <button ref={trigger} type="button" aria-label={triggerLabel} disabled={busy} onClick={() => setAsking(true)}
        className={triggerClassName ?? cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
        {children}
      </button>
    )
  }
  return (
    <span role="group" aria-label={question} className={cn('inline-flex flex-wrap items-center gap-2', className)}
      onKeyDown={(e) => { if (e.key === 'Escape') cancel() }}>
      <span className="text-[13px] font-medium text-danger">{question}</span>
      <button type="button" className={cn(buttonVariants({ variant: 'destructive', size: 'sm' }))}
        onClick={() => { setAsking(false); onConfirm() }}>
        {confirmLabel}
      </button>
      <button type="button" autoFocus className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))} onClick={cancel}>
        Cancelar
      </button>
    </span>
  )
}
