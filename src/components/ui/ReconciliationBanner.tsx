export interface ReconciliationResult {
  ok: boolean
  reasons: string[]
}

const KIND_ES: Record<string, string> = { stock: 'Acción', ON: 'ON' }
const kind = (k: string) => KIND_ES[k] ?? k

/** Internal reason codes stay English (backfill-gate); the user reads Spanish. */
const REASON_RULES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^cash: (\S+) replayed vs (\S+) stored$/, m => `Efectivo: tu historial da ${m[1]}, lo guardado es ${m[2]}`],
  [/^(\w+) (\S+): quantity (\S+) replayed vs (\S+) stored$/, m => `${kind(m[1])} ${m[2]}: cantidad según historial ${m[3]}, guardada ${m[4]}`],
  [/^(\w+) (\S+): invested (\S+) replayed vs (\S+) stored$/, m => `${kind(m[1])} ${m[2]}: invertido según historial ${m[3]}, guardado ${m[4]}`],
  [/^(\w+) (\S+): replay holds (\S+) but the DB has no position$/, m => `${kind(m[1])} ${m[2]}: el historial indica ${m[3]} pero no hay posición guardada`],
  [/^(\w+) (\S+): the DB holds (\S+) with no transactions behind it$/, m => `${kind(m[1])} ${m[2]}: hay ${m[3]} guardadas sin operaciones que las respalden`],
]

export function reasonToSpanish(reason: string): string {
  for (const [re, fmt] of REASON_RULES) {
    const m = reason.match(re)
    if (m) return fmt(m)
  }
  return `No se pudo comparar: ${reason}`
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
          {result.reasons.map(r => <li key={r}>{reasonToSpanish(r)}</li>)}
        </ul>
      </details>
    </div>
  )
}
