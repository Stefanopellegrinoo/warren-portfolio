import { formatNumber } from '@/lib/utils'

// Recharts styling from the design tokens, so every chart follows the light and dark themes.
export const GRID = { stroke: 'var(--line)', vertical: false } as const
export const AXIS_TICK = { fill: 'var(--ink-3)', fontSize: 11 }
export const AXIS = { tick: AXIS_TICK, axisLine: false, tickLine: false } as const
export const TOOLTIP = {
  contentStyle: {
    background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6,
    boxShadow: 'var(--shadow-pop)', color: 'var(--ink)', fontSize: 13,
  },
  labelStyle: { color: 'var(--ink-3)' },
  itemStyle: { color: 'var(--ink)' },
  cursor: { fill: 'var(--hover)', stroke: 'var(--line-strong)' },
}
export const GAIN = 'var(--ok-dot)'
export const LOSS = 'var(--danger-dot)'

/** Signed result, Argentine format: +1.234,56 / −1.234,56. */
export const signed = (n: number) => formatNumber(n, { sign: true })

/** Short signed axis label: +1,2k / −350. */
export const axisSigned = (v: number) =>
  Math.abs(v) >= 1000 ? `${formatNumber(v / 1000, { decimals: 1, sign: true })}k` : formatNumber(v, { decimals: 0, sign: true })
