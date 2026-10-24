import { formatNumber } from '@/lib/utils'

export type AlertOperator = 'crosses_above' | 'crosses_below'

export interface ChartAlert {
  id: string
  ticker: string
  operator: AlertOperator
  value: number
  name: string
  status: 'active' | 'triggered'
}

const HIT_TOLERANCE_PX = 6

/** The decimals the chart's price axis shows: four under 1 (a coin), two otherwise. */
export const priceDecimals = (price: number) => (Math.abs(price) < 1 ? 4 : 2)

/** The alert line under the pointer, or null. Lines off the price range are skipped. */
export function hitTestAlert(
  alerts: readonly { id: string; value: number }[],
  y: number,
  priceToY: (price: number) => number | null,
  tolerance = HIT_TOLERANCE_PX
): string | null {
  let best: string | null = null
  let bestDist = tolerance + 1
  for (const a of alerts) {
    const ay = priceToY(a.value)
    if (ay === null) continue
    const dist = Math.abs(ay - y)
    if (dist <= tolerance && dist < bestDist) {
      best = a.id
      bestDist = dist
    }
  }
  return best
}

/** A line above the price waits for the price to rise through it, and the mirror. */
export function operatorFor(value: number, lastPrice: number): AlertOperator {
  return value > lastPrice ? 'crosses_above' : 'crosses_below'
}

export function alertName(ticker: string, operator: AlertOperator, value: number): string {
  return `${ticker} cruza por ${operator === 'crosses_above' ? 'encima' : 'debajo'} de ${formatNumber(value, { decimals: priceDecimals(value) })}`
}
