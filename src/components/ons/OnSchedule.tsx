import type { ScheduleRow } from '@/lib/on-analytics'
import { fmtDate, fmtPct } from '@/lib/on-format'

const TH = 'px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-slate-400 whitespace-nowrap'
const TD = 'px-3 py-2 whitespace-nowrap'

/** Full future schedule: contractual date and the business-day adjusted pay date, coupon and amortization on the residual. */
export default function OnSchedule({ schedule, floating }: { schedule: ScheduleRow[]; floating: boolean }) {
  if (schedule.length === 0) return <p className="text-sm text-slate-400">Sin pagos futuros en el catálogo.</p>
  return (
    <>
      {floating && <p className="mb-2 text-xs text-slate-400">Tasa variable: los cupones no se proyectan; se muestran solo fechas y amortizaciones.</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm font-mono">
          <caption className="sr-only">Cronograma de pagos de la ON</caption>
          <thead>
            <tr className="border-b border-bg-600/60 text-right">
              <th scope="col" className={`${TH} text-left`}>Fecha</th>
              <th scope="col" className={`${TH} text-left`}>Fecha de pago</th>
              <th scope="col" className={TH}>Cupón</th>
              <th scope="col" className={TH}>Amortización</th>
              <th scope="col" className={TH}>Residual previo</th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((s) => (
              <tr key={s.date} className="table-row text-right">
                <td className={`${TD} text-left`}>{fmtDate(s.date)}</td>
                <td className={`${TD} text-left`}>
                  {fmtDate(s.payDate)}
                  {s.payDate !== s.date && <span className="ml-1.5 text-[10px] text-slate-500" title="El pago se corre al siguiente día hábil">(día hábil)</span>}
                </td>
                <td className={TD}>{s.couponPct === null ? '—' : fmtPct(s.couponPct, 4)}</td>
                <td className={TD}>{fmtPct(s.amortPct)}</td>
                <td className={TD}>{fmtPct(s.residualBeforePct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
