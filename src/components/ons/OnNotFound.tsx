import Link from 'next/link'

export default function OnNotFound() {
  return (
    <div className="glass flex flex-col items-start gap-3 rounded-2xl p-6" role="alert">
      <h1 className="font-display text-xl font-bold text-white">ON no encontrada</h1>
      <p className="text-sm text-slate-400">Ese ISIN no está en el catálogo. Puede que todavía no se haya cargado o que el código esté mal escrito.</p>
      <Link href="/ons" className="btn-ghost">Volver al listado de ONs</Link>
    </div>
  )
}
