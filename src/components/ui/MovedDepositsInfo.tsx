'use client'

import InfoLine from '@/components/ui/InfoLine'
import { formatDate, formatNumber } from '@/lib/utils'

/** Deposit money the derived history moved to the purchases it paid (statistics-truth S10). */
export interface FundedDeposits { amount: number; from: string }

/** The assumption behind a whole-portfolio series whose deposits were recorded after the purchases they paid (S10). */
export function fundedDepositsNote(data: { fundedDeposits?: FundedDeposits | null }): string | null {
  const f = data.fundedDeposits
  if (!f) return null
  return `Algunos depósitos estaban cargados después de las compras que pagaron: para medir, US$ ${formatNumber(f.amount)} se toman como depositados el día de esas compras, desde el ${formatDate(f.from)}. El total depositado no cambia.`
}

/**
 * A quiet line with the detail behind its (i) (odd/tasks/deposit-dates.md S5), and, where the page
 * can open it, the way to fix it for good: "Revisar fechas de depósitos" (S1).
 */
export default function MovedDepositsInfo({ note, className, onReview }: { note: string; className?: string; onReview?: () => void }) {
  return (
    <InfoLine className={className} label="Algunos depósitos se adelantaron a la fecha de tus compras" ariaLabel="Qué depósitos se adelantaron">
      <p>{note}</p>
      {onReview && (
        <button type="button" onClick={onReview} className="mt-2 min-h-8 font-medium text-accent underline underline-offset-2 hover:text-ink">
          Revisar fechas de depósitos
        </button>
      )}
    </InfoLine>
  )
}
