import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import ErrorScreen from '@/components/shell/ErrorScreen'

export default function NotFound() {
  return (
    <ErrorScreen fullPage title="No encontramos esta página"
      message="Puede que el enlace esté mal escrito o que la página ya no exista."
      actions={<Link href="/dashboard" className={cn(buttonVariants({ size: 'lg' }))}>Ir al Resumen</Link>} />
  )
}
