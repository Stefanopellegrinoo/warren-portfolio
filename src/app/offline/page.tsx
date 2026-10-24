'use client'

import ErrorScreen from '@/components/shell/ErrorScreen'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// What the service worker serves when a screen cannot load without connection (next.config.js
// `fallbacks`). The address bar usually keeps the page the user asked for, so retrying reloads it;
// opened as /offline itself, retrying goes to the Resumen instead of back to this page.
function retry() {
  if (window.location.pathname === '/offline') window.location.assign('/dashboard')
  else window.location.reload()
}

export default function OfflinePage() {
  return (
    <ErrorScreen fullPage title="Sin conexión"
      message="Warren necesita internet para mostrar tus datos al día. Revisá la conexión y probá de nuevo."
      actions={<button type="button" onClick={retry} className={cn(buttonVariants({ size: 'lg' }))}>Reintentar</button>} />
  )
}
