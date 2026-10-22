import Link from 'next/link'
import { btnSecondary } from './ui'

export default function OnNotFound() {
  return (
    <div className="grid justify-items-start gap-3 py-8" role="alert">
      <h1 className="font-serif text-2xl font-normal">ON no encontrada</h1>
      <p className="text-ink-2">Ese ISIN no está en el catálogo. Puede que todavía no se haya cargado o que el código esté mal escrito.</p>
      <Link href="/ons" className={btnSecondary}>Volver al listado de ONs</Link>
    </div>
  )
}
