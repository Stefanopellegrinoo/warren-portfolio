import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A screen that could not be shown: what happened, then the way out. */
export default function ErrorScreen({ title, message, actions, detail, fullPage = false }: {
  title: string
  message: string
  actions: ReactNode
  detail?: string
  // Outside the app shell (login, 404, root failures) it fills the viewport on its own.
  fullPage?: boolean
}) {
  return (
    <div className={cn('mx-auto flex max-w-md flex-col items-center justify-center px-4 py-12 text-center', fullPage ? 'min-h-dvh' : 'min-h-[60dvh]')}>
      <h1 className="font-serif text-2xl text-ink">{title}</h1>
      <p className="mt-2 text-sm text-ink-2">{message}</p>
      <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-center">{actions}</div>
      {detail && <p className="mt-6 text-xs text-ink-3">{detail}</p>}
    </div>
  )
}
