import { cn, formatUSD, formatPct } from '@/lib/utils'
import type { ReactNode } from 'react'

interface KpiCardProps {
  label: string
  value: number
  type?: 'currency' | 'percent'
  subValue?: string
  icon?: ReactNode
  highlight?: boolean
  featured?: boolean
  delay?: number
}

export default function KpiCard({ label, value, type = 'currency', subValue, icon, highlight, featured, delay = 0 }: KpiCardProps) {
  const isPositive = value > 0
  const isNegative = value < 0
  const isColored = type === 'percent' || highlight

  return (
    <div
      className={cn(
        'kpi-card animate-slide-up',
        featured && 'border-slate-400/20',
        highlight && isPositive && 'border-emerald/20 glow-emerald',
        highlight && isNegative && 'border-rose/20',
      )}
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono text-slate-400 uppercase tracking-widest">{label}</span>
        {icon && <span className="text-slate-500">{icon}</span>}
      </div>

      <div className={cn(
        'text-2xl font-bold tracking-tight mt-1',
        featured && 'text-3xl',
        isColored && isPositive && 'text-emerald',
        isColored && isNegative && 'text-rose',
        !isColored && 'text-white',
      )}>
        {type === 'currency' && formatUSD(value)}
        {type === 'percent' && formatPct(value)}
      </div>

      {subValue && (
        <span className="text-[11px] text-slate-400 font-mono">{subValue}</span>
      )}
    </div>
  )
}
