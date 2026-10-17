export interface ReconciliationResult {
  ok: boolean
  reasons: string[]
}

/** Amber notice when the stored portfolio disagrees with its own ledger. Null/ok renders nothing. */
export default function ReconciliationBanner({ result }: { result: ReconciliationResult | null }) {
  if (!result || result.ok) return null
  const n = result.reasons.length
  return (
    <div className="mb-6 rounded-xl border border-amber/30 bg-amber/10 px-4 py-3 text-amber animate-fade-in">
      <details>
        <summary className="cursor-pointer text-xs font-mono">
          Los saldos guardados no coinciden con tu historial de operaciones: {n} diferencia{n === 1 ? '' : 's'} (ver detalle)
        </summary>
        <ul className="mt-2 space-y-1 text-[11px] font-mono text-slate-300">
          {result.reasons.map(r => <li key={r}>{r}</li>)}
        </ul>
      </details>
    </div>
  )
}
