'use client'

import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/**
 * One quiet line for something secondary the screen must still disclose: its (i) opens the
 * detail on hover, on focus, or on a tap where there is no hover (odd/tasks/statistics-truth.md
 * S11). On a phone the (i) is a 44 px target without growing the line.
 */
export default function InfoLine({ label, ariaLabel, className, children }: {
  label: string
  ariaLabel: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('flex items-center gap-1 text-[13px] text-ink-3', className)}>
      {label}
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={100}
          aria-label={ariaLabel}
          className="-my-2.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring max-[819px]:h-11 max-[819px]:w-11"
        >
          <Info size={14} aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent className="max-w-[min(22rem,calc(100vw-2rem))] p-3 text-[13px] leading-snug">
          {children}
        </PopoverContent>
      </Popover>
    </div>
  )
}
