import type { HoldingRow } from '@/lib/resumen/holdings'

export const row = (over: Partial<HoldingRow>): HoldingRow => ({
  ticker: 'DUK', name: 'Duke Energy', kind: 'stock', quantityLabel: '40 acciones', weightPct: 12.08,
  dayChangePct: -0.005, value: 4827, pnl: 1027, pnlPct: 0.27, href: '/trading?symbol=DUK', ...over,
})

export const rows: HoldingRow[] = [
  row({}),
  row({ ticker: 'AAL', name: 'American Airlines', kind: 'cedear', quantityLabel: '25 CEDEARs', weightPct: 1.53, dayChangePct: 0.01, value: 612, pnl: -360, pnlPct: -0.371, href: '/trading?symbol=AAL' }),
  row({ ticker: 'NEW', name: null, quantityLabel: '5 acciones', weightPct: 0, dayChangePct: null, value: null, pnl: null, pnlPct: null, href: '/trading?symbol=NEW' }),
]
