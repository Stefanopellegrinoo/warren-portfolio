'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import ErrorScreen from './ErrorScreen'

// A code chunk that no longer exists: the app was updated while this page stayed open.
const STALE_CODE = /ChunkLoadError|Loading (CSS )?chunk|dynamically imported module|Importing a module script failed/i

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/** The error.tsx boundary of every section: Spanish text for what happened, never the raw error. */
export default function RouteError({ error, reset, fullPage = false }: {
  error: Error & { digest?: string }
  reset: () => void
  fullPage?: boolean
}) {
  useEffect(() => { console.error(error) }, [error])

  const primary = cn(buttonVariants({ size: 'lg' }))
  const secondary = cn(buttonVariants({ variant: 'outline', size: 'lg' }))

  // Offline first: without connection a chunk fails too, and reloading would not help.
  if (isOffline()) {
    return (
      <ErrorScreen fullPage={fullPage} title="Sin conexión"
        message="No se pudo cargar esta pantalla porque no hay internet. Cuando vuelva la conexión, tocá Reintentar."
        actions={<button type="button" onClick={reset} className={primary}>Reintentar</button>} />
    )
  }

  if (STALE_CODE.test(`${error.name} ${error.message}`)) {
    return (
      <ErrorScreen fullPage={fullPage} title="Hay una versión nueva de Warren"
        message="La app se actualizó mientras la tenías abierta. Recargá para seguir con la versión nueva."
        actions={<button type="button" onClick={() => window.location.reload()} className={primary}>Recargar</button>} />
    )
  }

  return (
    <ErrorScreen fullPage={fullPage} title="No se pudo mostrar esta pantalla"
      message="Ocurrió un error inesperado. Probá de nuevo y, si se repite, recargá la app."
      detail={error.digest ? `Código del error: ${error.digest}` : undefined}
      actions={<>
        <button type="button" onClick={reset} className={primary}>Reintentar</button>
        <Link href="/dashboard" className={secondary}>Ir al Resumen</Link>
      </>} />
  )
}
